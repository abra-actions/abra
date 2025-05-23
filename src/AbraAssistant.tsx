import React, { useState, useEffect, useRef } from "react";

const BACKEND_URL = "https://api.abra-actions.com";

export type ActionDefinition = {
    name: string;
    description: string;
    parameters: Record<string, any>;
};

type AssistantState = {
  expanded: boolean;
  input: string;
  status: string;
  result: any;
  error: string | null;
  isLoading: boolean;
  isProcessing: boolean;
  processingStep: number;
  showSuccess: boolean;
  previousContext: { action: string, params: Record<string, any> } | null;
};

type RegistryEntry = {
  name: string;
  function: Function;
  description?: string;
  suggested?: boolean;
  suggestion?: string;
};
  

export interface AbraConfig {
  apiKey: string;
  actionRegistry: RegistryEntry[];
  actions: ActionDefinition[];
}

interface AbraAssistantProps {
  config: AbraConfig;
}

const loadFonts = () => {
  if (!document.getElementById('abra-font-krona')) {
    const kronaFont = document.createElement('link');
    kronaFont.id = 'abra-font-krona';
    kronaFont.rel = 'stylesheet';
    kronaFont.href = 'https://fonts.googleapis.com/css2?family=Krona+One&display=swap';
    document.head.appendChild(kronaFont);
  }
  
  if (!document.getElementById('abra-font-inter')) {
    const interFont = document.createElement('link');
    interFont.id = 'abra-font-inter';
    interFont.rel = 'stylesheet';
    interFont.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap';
    document.head.appendChild(interFont);
  }
};

export const AbraAssistant: React.FC<AbraAssistantProps> = ({ config }) => {
  const { apiKey, actionRegistry, actions } = config;
  
  useEffect(() => {
    loadFonts();
  }, []);

  const [state, setState] = useState<AssistantState>({
    expanded: false,
    input: '',
    status: '',
    result: null,
    error: null,
    isLoading: false,
    isProcessing: false,
    processingStep: 0,
    showSuccess: false,
    previousContext: null,
  });

  const suggested: string[] = (Object.values(config.actionRegistry) as RegistryEntry[])
  .filter(entry => entry.suggested && entry.suggestion)
  .map(entry => entry.suggestion!);

  const registryMap = Object.fromEntries(
    actionRegistry.map(entry => [entry.name, entry])
  );

  const execute = async (name: string, params: any) => {
    const entry = registryMap[name];
    if (!entry || typeof entry.function !== "function") {
      throw new Error(`Action "${name}" not found`);
    }
    try {
      const result = await entry.function(params);
      return { success: true, result };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  };
  

  const textInputRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const processingSteps = [
    "Analyzing your request",
    "Identifying appropriate function",
    "Preparing execution parameters",
    "Executing function"
  ];

  const updateState = (partialState: Partial<AssistantState>) => {
    setState(prev => ({ ...prev, ...partialState }));
  };

  const adjustInputHeight = () => {
    if (textInputRef.current) {
      textInputRef.current.style.height = 'auto';
      const scrollHeight = textInputRef.current.scrollHeight;
      const maxHeight = 120;
      textInputRef.current.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
    }
  };

  useEffect(() => {
    adjustInputHeight();
  }, [state.input]);

  useEffect(() => {
    const adjustHeight = () => {
      if (contentRef.current && state.expanded) {
        const contentHeight = contentRef.current.scrollHeight;
        const maxHeight = window.innerHeight * 0.8;
        const minHeight = 300; 
        contentRef.current.style.maxHeight = `${Math.max(minHeight, Math.min(contentHeight + 40, maxHeight))}px`;
        setTimeout(() => {
          if (contentRef.current) {
            contentRef.current.scrollTop = contentRef.current.scrollHeight;
          }
        }, 50);
      }
    };

    adjustHeight();
    
    const observer = new MutationObserver(adjustHeight);
    
    if (contentRef.current) {
      observer.observe(contentRef.current, { 
        childList: true, 
        subtree: true,
        characterData: true
      });
    }
    window.addEventListener('resize', adjustHeight);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', adjustHeight);
    };
  }, [state.expanded, state.isProcessing, state.processingStep, state.showSuccess]);

  useEffect(() => {
    if (!state.expanded) {
      updateState({
        status: '',
        result: null,
        error: null,
        input: '',
        showSuccess: false,
        isProcessing: false,
        processingStep: 0
      });
    } else if (textInputRef.current) {
      textInputRef.current.focus();
    }
  }, [state.expanded]);

  useEffect(() => {
    let stepInterval: NodeJS.Timeout;

    if (state.isProcessing) {
      updateState({ processingStep: 0 });
      stepInterval = setInterval(() => {
        setState(prev => ({
          ...prev,
          processingStep: prev.processingStep < processingSteps.length - 1 
            ? prev.processingStep + 1 
            : prev.processingStep
        }));
      }, 600);
    }

    return () => clearInterval(stepInterval);
  }, [state.isProcessing, processingSteps.length]);

  const toggleExpanded = () => {
    updateState({ expanded: !state.expanded });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateState({ input: e.target.value });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as unknown as React.FormEvent);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!state.input.trim() || state.isLoading) return;
  
    updateState({
      isLoading: true,
      isProcessing: true,
      status: "Resolving action...",
      result: null,
      error: null,
      showSuccess: false
    });
  
    try {
      const res = await fetch(`${BACKEND_URL}/api/resolve-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify({ 
          userIntent: state.input, 
          actions: actions,
          previousContext: state.previousContext
        })
      });
  
      const aiResponse = await res.json();

      if (!res.ok) {
        const knownErrors: Record<string, string> = {
          MISSING_API_KEY: "Missing API key. Please configure your Abra API key.",
          INVALID_API_KEY: "Invalid API key. Double-check your configuration.",
          INACTIVE_API_KEY: "This API key is inactive.",
          TOKEN_LIMIT_EXCEEDED: "You've hit the free tier limit. Upgrade to continue using Abra.",
          INTERNAL_ERROR: "Something went wrong while resolving your request. Try again later."
        };
  
        updateState({
          error: knownErrors[aiResponse.code] || aiResponse.error || "An unknown error occurred.",
          status: "Request failed"
        });
        return;
      }
  
      if (aiResponse.followup) {
        updateState({
          status: aiResponse.followup.message,
          previousContext: {
            action: aiResponse.action,
            params: { 
              ...state.previousContext?.params,
              ...aiResponse.params
            }
          },
          input: '',
          isLoading: false,
          isProcessing: false,
        });
        return;
      }
  
      const executionResult = await execute(aiResponse.action, aiResponse.params);
  
      if (executionResult.success) {
        updateState({
          result: executionResult.result,
          status: ``,
          input: '',
          previousContext: null, 
          showSuccess: true
        });
      } else {
        throw new Error(executionResult.error);
      }
    } catch (err: any) {
      updateState({
        error: err.message,
        status: "Operation failed"
      });
    } finally {
      updateState({
        isLoading: false,
        isProcessing: false
      });
    }
  };

  const ArrowIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M5 12H19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M12 5L19 12L12 19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
  
  const styles = `@import url('https://fonts.googleapis.com/css2?family=Krona+One&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

.abra-container {
  position: fixed;
  bottom: 24px;
  right: 24px;
  width: 380px;
  max-width: calc(100% - 48px);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(74, 229, 131, 0.15);
  background-color: rgba(14, 14, 14, 0.95);
  backdrop-filter: blur(10px);
  overflow: hidden;
  z-index: 10000;
  animation: fadeIn 0.3s ease-out;
}

.abra-header {
  padding: 14px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background-color: rgba(14, 14, 14, 0.98);
}

.abra-title {
  margin: 0;
  color: #f0f0f0;
  font-size: 1.25rem;
  font-weight: 500;
  font-family: 'Krona One', sans-serif;
  letter-spacing: -0.02em;
}

.abra-close-button {
  background: none;
  border: none;
  color: #999;
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0;
  transition: color 0.2s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}

.abra-close-button:hover {
  color: #4AE583;
}

.abra-content {
  padding: 16px;
  background-color: #111111;
  max-height: 60vh;
  overflow-y: auto;
  transition: max-height 0.3s ease-out;
}

.abra-message-container {
  margin-bottom: 16px;
}

.abra-message {
  background-color: rgba(255, 255, 255, 0.03);
  color: #f0f0f0;
  padding: 12px 16px;
  border-radius: 8px;
  margin-bottom: 12px;
  font-size: 0.95rem;
  line-height: 1.5;
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255, 255, 255, 0.03);
}

.abra-message strong {
  color: #fff;
  font-family: 'Krona One', sans-serif;
  font-size: 0.9rem;
  letter-spacing: -0.01em;
}

.abra-message ul {
  margin-top: 10px;
}

.abra-message li {
  margin-bottom: 6px;
  color: #ccc;
  position: relative;
  transition: color 0.15s ease, transform 0.15s ease;
  padding-left: 5px;
}

.abra-message li:hover {
  color: #4AE583;
  cursor: pointer;
  transform: translateX(2px);
}

.error-message {
  background: linear-gradient(135deg, rgba(255, 82, 82, 0.08) 0%, rgba(255, 82, 82, 0.02) 100%) !important;
  border: none !important;
  position: relative;
  color: #ff8a8a !important;
  box-shadow: 0 4px 12px rgba(255, 82, 82, 0.15);
  overflow: hidden;
}

.error-message::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 4px;
  height: 100%;
  background: linear-gradient(to bottom, #ff5252, rgba(255, 82, 82, 0.5));
}

.error-message::after {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  width: 100%;
  height: 1px;
  background: linear-gradient(to right, transparent, rgba(255, 82, 82, 0.5), transparent);
}

.result-message {
  background-color: rgba(40, 40, 40, 0.7);
  font-family: monospace;
}

.abra-thinking-container {
  margin: 12px 0;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  padding: 12px;
  border: 1px solid rgba(255, 255, 255, 0.03);
}

.abra-thinking-step {
  color: #aaa;
  font-size: 0.9rem;
  display: flex;
  align-items: center;
  margin-bottom: 8px;
}

.abra-step-checkmark {
  color: #4AE583;
  margin-right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
}

.abra-loader {
  border: 2px solid rgba(74, 229, 131, 0.1);
  border-top: 2px solid #4AE583;
  border-right: 2px solid #4AE583;
  border-radius: 50%;
  width: 14px;
  height: 14px;
  animation: spin 0.8s linear infinite;
  margin-right: 8px;
}

.abra-success-message {
  background: linear-gradient(135deg, rgba(74, 229, 131, 0.08) 0%, rgba(74, 229, 131, 0.02) 100%);
  border: none;
  color: #4AE583;
  border-radius: 8px;
  padding: 16px;
  margin: 12px 0;
  position: relative;
  backdrop-filter: blur(4px);
  box-shadow: 0 4px 12px rgba(74, 229, 131, 0.1);
  overflow: hidden;
  display: flex;
  align-items: center;
}

.abra-success-message::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  width: 4px;
  height: 100%;
  background: linear-gradient(to bottom, #4AE583, rgba(74, 229, 131, 0.5));
}

.abra-success-message::after {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  width: 100%;
  height: 1px;
  background: linear-gradient(to right, transparent, rgba(74, 229, 131, 0.5), transparent);
}

.abra-success-icon {
  margin-right: 8px;
  width: 20px;
  height: 20px;
  background: rgba(74, 229, 131, 0.2);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.abra-input-container {
  display: flex;
  margin-top: 8px;
  position: relative;
}

.abra-input {
  flex: 1;
  padding: 12px 46px 12px 16px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background-color: rgba(20, 20, 20, 0.8);
  color: #f0f0f0;
  font-size: 0.95rem;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  min-height: 46px;
  height: auto;
  max-height: 120px;
  overflow-y: auto;
  resize: none;
  transition: border-color 0.2s ease, min-height 0.2s ease, box-shadow 0.2s ease;
}

.abra-input:focus {
  outline: none;
  border-color: rgba(74, 229, 131, 0.5);
  box-shadow: 0 0 0 2px rgba(74, 229, 131, 0.1), 0 2px 8px rgba(0, 0, 0, 0.1);
}

.abra-send-button {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  background: rgba(74, 229, 131, 0.9);
  border: none;
  border-radius: 8px;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: transform 0.2s ease, background-color 0.2s ease;
}

.abra-send-button:hover {
  transform: translateY(-50%) scale(1.05);
  background-color: #4AE583;
}

.abra-send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background-color: rgba(74, 229, 131, 0.3);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes pulse {
  0% { box-shadow: 0 0 0 0 rgba(74, 229, 131, 0.4); }
  70% { box-shadow: 0 0 0 10px rgba(74, 229, 131, 0); }
  100% { box-shadow: 0 0 0 0 rgba(74, 229, 131, 0); }
}

@keyframes shiftGradient {
  0% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
  100% { background-position: 0% 50%; }
}

@media (max-width: 480px) {
  .abra-container {
    width: calc(100% - 32px);
    right: 16px;
    bottom: 16px;
  }
}

.abra-header {
  padding: 16px 18px !important;
  background-color: #121212 !important;
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  border-bottom: 1px solid rgba(74, 229, 131, 0.15) !important;
}

.abra-title {
  font-family: 'Krona One', sans-serif !important;
  font-size: 1.5rem !important;
  font-weight: bold !important;
  color: #f0f0f0 !important;
  letter-spacing: -0.02em !important;
  margin: 0 !important;
}

.abra-header-branding {
  display: flex;
  align-items: center;
  gap: 12px;
}

.abra-close-button {
  background: rgba(40, 40, 40, 0.95) !important;
  color: #f0f0f0 !important;
  border-radius: 50% !important;
  width: 32px !important;
  height: 32px !important;
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  border: none !important;
  cursor: pointer !important;
  font-size: 1.5rem !important;
}

.abra-welcome-message {
  background: #1e2b1e !important;
  border-left: 4px solid #4AE583 !important;
  color: #f0f0f0 !important;
  padding: 16px !important;
  border-radius: 8px !important;
  margin-bottom: 16px !important;
}

.abra-welcome-message strong {
  display: block !important;
  margin-bottom: 8px !important;
  color: #f0f0f0 !important;
  font-size: 1.2rem !important;
}

.abra-welcome-message p {
  margin: 0 !important;
  color: #f0f0f0 !important;
  font-size: 0.95rem !important;
  line-height: 1.5 !important;
}

.abra-chat-button {
  position: fixed;
  bottom: 8px;
  right: 16px;
  z-index: 10000;
}

.abra-chat-button-inner {
  background: transparent;
  border: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  transition: transform 0.2s ease;
  position: relative;
}

.abra-chat-button-inner:hover {
  transform: scale(1.05);
}

.abra-logo-image {
  width: 110px;
  height: 110px;
  display: block;
  background-color: transparent !important;
  border: none;
  box-shadow: none;
  filter: drop-shadow(0 0 8px rgba(74, 229, 131, 0.4));
}`;

  if (!state.expanded) {
    return (
      <>
        <style>{styles}</style>
        <div className="abra-chat-button">
          <button
            onClick={toggleExpanded}
            className="abra-chat-button-inner"
            aria-label="Open Abra Assistant"
          >
            <svg width="110" height="110" viewBox="0 0 149 149" fill="none" xmlns="http://www.w3.org/2000/svg">
              <g filter="url(#filter0_d_5_2)">
              <path d="M119 74.5C119 99.0767 99.0767 119 74.5 119C49.9233 119 30 99.0767 30 74.5C30 49.9233 49.9233 30 74.5 30C99.0767 30 119 49.9233 119 74.5Z" fill="#232323"/>
              <path d="M74.5 31C98.5244 31 118 50.4756 118 74.5C118 98.5244 98.5244 118 74.5 118C50.4756 118 31 98.5244 31 74.5C31 50.4756 50.4756 31 74.5 31Z" stroke="#22C75E" strokeWidth="2"/>
              </g>
              <g filter="url(#filter1_d_5_2)">
              <mask id="path-3-inside-1_5_2" fill="none">
              <path d="M80.8133 64.6867C80.2392 63.9455 79.4578 63.3915 78.5683 63.095L76.2717 62.3483C76.0953 62.2856 75.9428 62.1698 75.8349 62.0168C75.727 61.8639 75.669 61.6813 75.669 61.4942C75.669 61.307 75.727 61.1244 75.8349 60.9715C75.9428 60.8186 76.0953 60.7028 76.2717 60.64L78.5683 59.8933C79.2479 59.6586 79.8652 59.2722 80.3731 58.7634C80.8811 58.2545 81.2665 57.6367 81.5 56.9567L81.5183 56.9L82.265 54.605C82.3271 54.4275 82.4428 54.2737 82.5961 54.1649C82.7494 54.0561 82.9328 53.9977 83.1208 53.9977C83.3089 53.9977 83.4922 54.0561 83.6456 54.1649C83.7989 54.2737 83.9146 54.4275 83.9767 54.605L84.7217 56.9C84.9546 57.5976 85.3468 58.2313 85.8672 58.7509C86.3877 59.2705 87.022 59.6616 87.72 59.8933L90.015 60.64L90.0617 60.6517C90.238 60.7144 90.3906 60.8302 90.4985 60.9832C90.6064 61.1361 90.6643 61.3187 90.6643 61.5058C90.6643 61.693 90.6064 61.8756 90.4985 62.0285C90.3906 62.1814 90.238 62.2972 90.0617 62.36L87.765 63.1067C87.0674 63.3386 86.4333 63.7299 85.9132 64.2494C85.393 64.769 85.0011 65.4026 84.7683 66.1L84.0217 68.395L84 68.4517C83.928 68.6194 83.807 68.7614 83.653 68.8593C83.4989 68.9571 83.3189 69.0062 83.1365 69.0001C82.9541 68.994 82.7777 68.9329 82.6306 68.825C82.4834 68.717 82.3723 68.5672 82.3117 68.395L81.565 66.1C81.3982 65.5892 81.1445 65.1111 80.815 64.6867M93.64 71.0217L92.3633 70.6083C91.9759 70.4788 91.624 70.261 91.3353 69.972C91.0466 69.683 90.8291 69.3309 90.7 68.9433L90.2833 67.67C90.2488 67.5716 90.1846 67.4863 90.0995 67.4259C90.0144 67.3656 89.9127 67.3332 89.8083 67.3332C89.704 67.3332 89.6023 67.3656 89.5172 67.4259C89.4321 67.4863 89.3678 67.5716 89.3333 67.67L88.92 68.9433C88.7932 69.3284 88.5793 69.6789 88.2948 69.9677C88.0104 70.2565 87.6631 70.4758 87.28 70.6083L86.005 71.0217C85.9066 71.0562 85.8213 71.1204 85.7609 71.2055C85.7006 71.2906 85.6682 71.3924 85.6682 71.4967C85.6682 71.601 85.7006 71.7027 85.7609 71.7878C85.8213 71.8729 85.9066 71.9372 86.005 71.9717L87.28 72.3867C87.6685 72.5162 88.0215 72.7347 88.3108 73.0246C88.6002 73.3145 88.8179 73.6679 88.9467 74.0567L89.36 75.33C89.3945 75.4285 89.4588 75.5137 89.5438 75.5741C89.6289 75.6344 89.7307 75.6668 89.835 75.6668C89.9393 75.6668 90.0411 75.6344 90.1262 75.5741C90.2112 75.5137 90.2755 75.4285 90.31 75.33L90.725 74.0567C90.8543 73.669 91.072 73.3167 91.361 73.0277C91.65 72.7387 92.0023 72.521 92.39 72.3917L93.665 71.9783C93.7634 71.9438 93.8487 71.8796 93.9091 71.7945C93.9694 71.7094 94.0018 71.6077 94.0018 71.5033C94.0018 71.399 93.9694 71.2973 93.9091 71.2122C93.8487 71.1271 93.7634 71.0628 93.665 71.0283L93.64 71.0217ZM74 57.3333C75.595 57.3333 77.1383 57.5567 78.5983 57.975C78.405 58.0947 78.1987 58.192 77.9833 58.265L75.75 58.9983C75.2802 59.1658 74.8649 59.4579 74.5483 59.8433C72.6432 59.7695 70.7427 60.0811 68.9608 60.7593C67.1789 61.4375 65.5522 62.4684 64.1782 63.7902C62.8042 65.1121 61.7112 66.6977 60.9646 68.452C60.218 70.2064 59.8333 72.0934 59.8333 74C59.8333 76.45 60.455 78.805 61.6217 80.895L61.8717 81.345L60.0183 87.985L66.6633 86.1317L67.1133 86.3817C69.0887 87.4803 71.2983 88.0903 73.5575 88.161C75.8167 88.2316 78.0601 87.7608 80.1003 86.7877C82.1404 85.8147 83.9182 84.3678 85.2852 82.5676C86.6522 80.7675 87.5688 78.6665 87.9583 76.44C88.1094 76.6644 88.2956 76.8561 88.5167 77.015C88.7764 77.2006 89.0741 77.3261 89.3884 77.3823C89.7026 77.4386 90.0254 77.4241 90.3333 77.34C88.7833 84.945 82.06 90.6667 74 90.6667C71.34 90.6703 68.718 90.0347 66.355 88.8133L59.9783 90.5917C59.6226 90.691 59.2468 90.6939 58.8895 90.6001C58.5323 90.5064 58.2064 90.3193 57.9452 90.0582C57.684 89.797 57.497 89.4711 57.4032 89.1138C57.3095 88.7565 57.3124 88.3808 57.4117 88.025L59.1917 81.6533C57.9673 79.2882 57.3299 76.6633 57.3333 74C57.3333 64.795 64.795 57.3333 74 57.3333Z"/>
              </mask>
              <path d="M80.8133 64.6867C80.2392 63.9455 79.4578 63.3915 78.5683 63.095L76.2717 62.3483C76.0953 62.2856 75.9428 62.1698 75.8349 62.0168C75.727 61.8639 75.669 61.6813 75.669 61.4942C75.669 61.307 75.727 61.1244 75.8349 60.9715C75.9428 60.8186 76.0953 60.7028 76.2717 60.64L78.5683 59.8933C79.2479 59.6586 79.8652 59.2722 80.3731 58.7634C80.8811 58.2545 81.2665 57.6367 81.5 56.9567L81.5183 56.9L82.265 54.605C82.3271 54.4275 82.4428 54.2737 82.5961 54.1649C82.7494 54.0561 82.9328 53.9977 83.1208 53.9977C83.3089 53.9977 83.4922 54.0561 83.6456 54.1649C83.7989 54.2737 83.9146 54.4275 83.9767 54.605L84.7217 56.9C84.9546 57.5976 85.3468 58.2313 85.8672 58.7509C86.3877 59.2705 87.022 59.6616 87.72 59.8933L90.015 60.64L90.0617 60.6517C90.238 60.7144 90.3906 60.8302 90.4985 60.9832C90.6064 61.1361 90.6643 61.3187 90.6643 61.5058C90.6643 61.693 90.6064 61.8756 90.4985 62.0285C90.3906 62.1814 90.238 62.2972 90.0617 62.36L87.765 63.1067C87.0674 63.3386 86.4333 63.7299 85.9132 64.2494C85.393 64.769 85.0011 65.4026 84.7683 66.1L84.0217 68.395L84 68.4517C83.928 68.6194 83.807 68.7614 83.653 68.8593C83.4989 68.9571 83.3189 69.0062 83.1365 69.0001C82.9541 68.994 82.7777 68.9329 82.6306 68.825C82.4834 68.717 82.3723 68.5672 82.3117 68.395L81.565 66.1C81.3982 65.5892 81.1445 65.1111 80.815 64.6867M93.64 71.0217L92.3633 70.6083C91.9759 70.4788 91.624 70.261 91.3353 69.972C91.0466 69.683 90.8291 69.3309 90.7 68.9433L90.2833 67.67C90.2488 67.5716 90.1846 67.4863 90.0995 67.4259C90.0144 67.3656 89.9127 67.3332 89.8083 67.3332C89.704 67.3332 89.6023 67.3656 89.5172 67.4259C89.4321 67.4863 89.3678 67.5716 89.3333 67.67L88.92 68.9433C88.7932 69.3284 88.5793 69.6789 88.2948 69.9677C88.0104 70.2565 87.6631 70.4758 87.28 70.6083L86.005 71.0217C85.9066 71.0562 85.8213 71.1204 85.7609 71.2055C85.7006 71.2906 85.6682 71.3924 85.6682 71.4967C85.6682 71.601 85.7006 71.7027 85.7609 71.7878C85.8213 71.8729 85.9066 71.9372 86.005 71.9717L87.28 72.3867C87.6685 72.5162 88.0215 72.7347 88.3108 73.0246C88.6002 73.3145 88.8179 73.6679 88.9467 74.0567L89.36 75.33C89.3945 75.4285 89.4588 75.5137 89.5438 75.5741C89.6289 75.6344 89.7307 75.6668 89.835 75.6668C89.9393 75.6668 90.0411 75.6344 90.1262 75.5741C90.2112 75.5137 90.2755 75.4285 90.31 75.33L90.725 74.0567C90.8543 73.669 91.072 73.3167 91.361 73.0277C91.65 72.7387 92.0023 72.521 92.39 72.3917L93.665 71.9783C93.7634 71.9438 93.8487 71.8796 93.9091 71.7945C93.9694 71.7094 94.0018 71.6077 94.0018 71.5033C94.0018 71.399 93.9694 71.2973 93.9091 71.2122C93.8487 71.1271 93.7634 71.0628 93.665 71.0283L93.64 71.0217ZM74 57.3333C75.595 57.3333 77.1383 57.5567 78.5983 57.975C78.405 58.0947 78.1987 58.192 77.9833 58.265L75.75 58.9983C75.2802 59.1658 74.8649 59.4579 74.5483 59.8433C72.6432 59.7695 70.7427 60.0811 68.9608 60.7593C67.1789 61.4375 65.5522 62.4684 64.1782 63.7902C62.8042 65.1121 61.7112 66.6977 60.9646 68.452C60.218 70.2064 59.8333 72.0934 59.8333 74C59.8333 76.45 60.455 78.805 61.6217 80.895L61.8717 81.345L60.0183 87.985L66.6633 86.1317L67.1133 86.3817C69.0887 87.4803 71.2983 88.0903 73.5575 88.161C75.8167 88.2316 78.0601 87.7608 80.1003 86.7877C82.1404 85.8147 83.9182 84.3678 85.2852 82.5676C86.6522 80.7675 87.5688 78.6665 87.9583 76.44C88.1094 76.6644 88.2956 76.8561 88.5167 77.015C88.7764 77.2006 89.0741 77.3261 89.3884 77.3823C89.7026 77.4386 90.0254 77.4241 90.3333 77.34C88.7833 84.945 82.06 90.6667 74 90.6667C71.34 90.6703 68.718 90.0347 66.355 88.8133L59.9783 90.5917C59.6226 90.691 59.2468 90.6939 58.8895 90.6001C58.5323 90.5064 58.2064 90.3193 57.9452 90.0582C57.684 89.797 57.497 89.4711 57.4032 89.1138C57.3095 88.7565 57.3124 88.3808 57.4117 88.025L59.1917 81.6533C57.9673 79.2882 57.3299 76.6633 57.3333 74C57.3333 64.795 64.795 57.3333 74 57.3333Z" fill="#22C75E"/>
              <path d="M78.5683 63.095L80.1496 58.3516L80.1319 58.3457L80.1142 58.34L78.5683 63.095ZM76.2717 62.3483L74.5949 67.0588L74.66 67.082L74.7258 67.1034L76.2717 62.3483ZM76.2717 60.64L74.7258 55.885L74.66 55.9064L74.5949 55.9295L76.2717 60.64ZM78.5683 59.8933L80.1142 64.6484L80.1575 64.6343L80.2004 64.6195L78.5683 59.8933ZM81.5 56.9567L86.2289 58.5807L86.2435 58.5383L86.2572 58.4957L81.5 56.9567ZM81.5183 56.9L76.7636 55.3531L76.7611 55.3609L81.5183 56.9ZM82.265 54.605L77.5453 52.9543L77.5273 53.006L77.5103 53.0581L82.265 54.605ZM83.9767 54.605L88.7324 53.0612L88.715 53.0076L88.6963 52.9543L83.9767 54.605ZM84.7217 56.9L79.966 58.4438L79.9724 58.4636L79.979 58.4833L84.7217 56.9ZM87.72 59.8933L86.1446 64.6387L86.1588 64.6434L86.1731 64.648L87.72 59.8933ZM90.015 60.64L88.4681 65.3947L88.6335 65.4485L88.8023 65.4907L90.015 60.64ZM90.0617 60.6517L91.7384 55.9412L91.5098 55.8598L91.2743 55.801L90.0617 60.6517ZM90.0617 62.36L91.6076 67.115L91.6733 67.0937L91.7384 67.0705L90.0617 62.36ZM87.765 63.1067L86.2191 58.3517L86.2033 58.3568L86.1876 58.362L87.765 63.1067ZM84.7683 66.1L80.0254 64.5173L80.0195 64.5352L80.0136 64.5531L84.7683 66.1ZM84.0217 68.395L88.6919 70.1808L88.7372 70.0624L88.7764 69.9419L84.0217 68.395ZM84 68.4517L88.5944 70.4244L88.6342 70.3317L88.6702 70.2374L84 68.4517ZM82.3117 68.395L77.557 69.9419L77.5755 69.9988L77.5954 70.0553L82.3117 68.395ZM81.565 66.1L86.3197 64.5531L86.3181 64.5481L81.565 66.1ZM93.64 71.0217L92.0999 75.7786L92.2248 75.819L92.3517 75.8529L93.64 71.0217ZM92.3633 70.6083L90.778 75.3503L90.8006 75.3579L90.8232 75.3652L92.3633 70.6083ZM90.7 68.9433L85.9479 70.4983L85.9521 70.5111L85.9564 70.5239L90.7 68.9433ZM90.2833 67.67L95.0354 66.115L95.0191 66.0654L95.0019 66.0161L90.2833 67.67ZM89.3333 67.67L84.6148 66.0161L84.5956 66.071L84.5776 66.1263L89.3333 67.67ZM88.92 68.9433L93.6692 70.507L93.6725 70.497L93.6757 70.4871L88.92 68.9433ZM87.28 70.6083L88.8219 75.3646L88.8688 75.3495L88.9153 75.3334L87.28 70.6083ZM86.005 71.0217L84.4631 66.2654L84.4069 66.2836L84.3511 66.3031L86.005 71.0217ZM86.005 71.9717L84.3511 76.6902L84.4041 76.7088L84.4575 76.7262L86.005 71.9717ZM87.28 72.3867L88.8618 67.6435L88.8447 67.6378L88.8275 67.6322L87.28 72.3867ZM88.9467 74.0567L93.7024 72.5129L93.6977 72.4986L93.693 72.4844L88.9467 74.0567ZM89.36 75.33L84.6043 76.8737L84.6222 76.929L84.6415 76.9839L89.36 75.33ZM90.31 75.33L95.0285 76.9839L95.0468 76.9318L95.0639 76.8794L90.31 75.33ZM90.725 74.0567L85.9818 72.4749L85.9764 72.4911L85.9711 72.5073L90.725 74.0567ZM92.39 72.3917L90.8481 67.6354L90.8281 67.6418L90.8082 67.6485L92.39 72.3917ZM93.665 71.9783L95.2069 76.7346L95.2631 76.7164L95.3189 76.6969L93.665 71.9783ZM93.665 71.0283L95.3189 66.3098L95.1382 66.2465L94.9533 66.1972L93.665 71.0283ZM78.5983 57.975L81.2296 62.2266L90.8372 56.2806L79.9756 53.1684L78.5983 57.975ZM77.9833 58.265L79.5432 63.0155L79.5664 63.0078L79.5896 63L77.9833 58.265ZM75.75 58.9983L74.1901 54.2479L74.1302 54.2675L74.0709 54.2887L75.75 58.9983ZM74.5483 59.8433L74.3548 64.8396L76.8363 64.9357L78.4123 63.0166L74.5483 59.8433ZM59.8333 74L64.8333 74L64.8333 73.9998L59.8333 74ZM61.6217 80.895L65.9925 78.4668L65.9875 78.4579L61.6217 80.895ZM61.8717 81.345L66.6876 82.6892L67.2396 80.7116L66.2425 78.9168L61.8717 81.345ZM60.0183 87.985L55.2024 86.6408L52.8178 95.1841L61.3616 92.8012L60.0183 87.985ZM66.6633 86.1317L69.0916 81.7609L67.2972 80.764L65.3201 81.3155L66.6633 86.1317ZM67.1133 86.3817L69.5435 82.012L69.5416 82.0109L67.1133 86.3817ZM87.9583 76.44L92.1059 73.6476L85.1727 63.3497L83.0331 75.5783L87.9583 76.44ZM88.5167 77.015L85.5989 81.0754L85.609 81.0826L88.5167 77.015ZM89.3884 77.3823L88.5078 82.3042L89.3884 77.3823ZM90.3333 77.34L95.2326 78.3385L96.8555 70.376L89.0162 72.5166L90.3333 77.34ZM74 90.6667L74 85.6667L73.9931 85.6667L74 90.6667ZM66.355 88.8133L68.6508 84.3716L66.9049 83.4692L65.0118 83.9971L66.355 88.8133ZM59.9783 90.5917L58.6352 85.7755L58.6343 85.7757L59.9783 90.5917ZM57.4117 88.025L52.5961 86.6797L52.5957 86.681L57.4117 88.025ZM59.1917 81.6533L64.0073 82.9986L64.5369 81.1027L63.6319 79.3546L59.1917 81.6533ZM57.3333 74L62.3333 74.0065V74H57.3333ZM80.8133 64.6867L84.766 61.6246C83.5853 60.1005 81.9786 58.9613 80.1496 58.3516L78.5683 63.095L76.9871 67.8384C76.937 67.8217 76.893 67.7905 76.8606 67.7487L80.8133 64.6867ZM78.5683 63.095L80.1142 58.34L77.8176 57.5933L76.2717 62.3483L74.7258 67.1034L77.0224 67.85L78.5683 63.095ZM76.2717 62.3483L77.9484 57.6379C78.7445 57.9212 79.4333 58.444 79.9204 59.1344L75.8349 62.0168L71.7493 64.8992C72.4522 65.8955 73.4462 66.6499 74.5949 67.0588L76.2717 62.3483ZM75.8349 62.0168L79.9204 59.1344C80.4075 59.8249 80.669 60.6492 80.669 61.4942H75.669H70.669C70.669 62.7135 71.0464 63.9029 71.7493 64.8992L75.8349 62.0168ZM75.669 61.4942H80.669C80.669 62.3392 80.4075 63.1634 79.9204 63.8539L75.8349 60.9715L71.7493 58.0891C71.0464 59.0854 70.669 60.2748 70.669 61.4942H75.669ZM75.8349 60.9715L79.9204 63.8539C79.4333 64.5443 78.7445 65.0671 77.9484 65.3505L76.2717 60.64L74.5949 55.9295C73.4462 56.3384 72.4522 57.0928 71.7493 58.0891L75.8349 60.9715ZM76.2717 60.64L77.8176 65.395L80.1142 64.6484L78.5683 59.8933L77.0224 55.1383L74.7258 55.885L76.2717 60.64ZM78.5683 59.8933L80.2004 64.6195C81.5979 64.1369 82.8671 63.3422 83.9117 62.2959L80.3731 58.7634L76.8346 55.2309C76.8632 55.2022 76.898 55.1804 76.9363 55.1672L78.5683 59.8933ZM80.3731 58.7634L83.9117 62.2959C84.9562 61.2496 85.7487 59.979 86.2289 58.5807L81.5 56.9567L76.7711 55.3326C76.7843 55.2943 76.806 55.2595 76.8346 55.2309L80.3731 58.7634ZM81.5 56.9567L86.2572 58.4957L86.2756 58.4391L81.5183 56.9L76.7611 55.3609L76.7428 55.4176L81.5 56.9567ZM81.5183 56.9L86.273 58.4469L87.0197 56.1519L82.265 54.605L77.5103 53.0581L76.7636 55.3531L81.5183 56.9ZM82.265 54.605L86.9847 56.2557C86.7044 57.0569 86.182 57.7513 85.4898 58.2425L82.5961 54.1649L79.7024 50.0873C78.7035 50.7962 77.9497 51.7981 77.5453 52.9543L82.265 54.605ZM82.5961 54.1649L85.4898 58.2425C84.7975 58.7338 83.9697 58.9977 83.1208 58.9977V53.9977V48.9977C81.8959 48.9977 80.7014 49.3785 79.7024 50.0873L82.5961 54.1649ZM83.1208 53.9977V58.9977C82.272 58.9977 81.4441 58.7338 80.7519 58.2425L83.6456 54.1649L86.5392 50.0873C85.5403 49.3785 84.3457 48.9977 83.1208 48.9977V53.9977ZM83.6456 54.1649L80.7519 58.2425C80.0596 57.7513 79.5372 57.0569 79.257 56.2557L83.9767 54.605L88.6963 52.9543C88.292 51.7981 87.5381 50.7962 86.5392 50.0873L83.6456 54.1649ZM83.9767 54.605L79.221 56.1488L79.966 58.4438L84.7217 56.9L89.4774 55.3562L88.7324 53.0612L83.9767 54.605ZM84.7217 56.9L79.979 58.4833C80.4579 59.9178 81.2644 61.2209 82.3346 62.2893L85.8672 58.7509L89.3998 55.2124C89.4291 55.2417 89.4512 55.2774 89.4643 55.3167L84.7217 56.9ZM85.8672 58.7509L82.3346 62.2893C83.4049 63.3578 84.7093 64.1622 86.1446 64.6387L87.72 59.8933L89.2954 55.148C89.3348 55.1611 89.3705 55.1831 89.3998 55.2124L85.8672 58.7509ZM87.72 59.8933L86.1731 64.648L88.4681 65.3947L90.015 60.64L91.5619 55.8853L89.2669 55.1386L87.72 59.8933ZM90.015 60.64L88.8023 65.4907L88.849 65.5024L90.0617 60.6517L91.2743 55.801L91.2277 55.7893L90.015 60.64ZM90.0617 60.6517L88.3849 65.3621C87.5889 65.0788 86.9 64.556 86.4129 63.8656L90.4985 60.9832L94.584 58.1008C93.8811 57.1044 92.8871 56.3501 91.7384 55.9412L90.0617 60.6517ZM90.4985 60.9832L86.4129 63.8656C85.9258 63.1751 85.6643 62.3508 85.6643 61.5058H90.6643H95.6643C95.6643 60.2865 95.2869 59.0971 94.584 58.1008L90.4985 60.9832ZM90.6643 61.5058H85.6643C85.6643 60.6608 85.9258 59.8366 86.4129 59.1461L90.4985 62.0285L94.584 64.9109C95.2869 63.9146 95.6643 62.7252 95.6643 61.5058H90.6643ZM90.4985 62.0285L86.4129 59.1461C86.9 58.4556 87.5889 57.9329 88.3849 57.6495L90.0617 62.36L91.7384 67.0705C92.8871 66.6616 93.8811 65.9072 94.584 64.9109L90.4985 62.0285ZM90.0617 62.36L88.5158 57.605L86.2191 58.3517L87.765 63.1067L89.3109 67.8617L91.6076 67.115L90.0617 62.36ZM87.765 63.1067L86.1876 58.362C84.753 58.839 83.4492 59.6435 82.3796 60.7119L85.9132 64.2494L89.4467 67.7869C89.4174 67.8162 89.3817 67.8383 89.3424 67.8513L87.765 63.1067ZM85.9132 64.2494L82.3796 60.7119C81.31 61.7804 80.504 63.0832 80.0254 64.5173L84.7683 66.1L89.5112 67.6827C89.4981 67.722 89.476 67.7577 89.4467 67.7869L85.9132 64.2494ZM84.7683 66.1L80.0136 64.5531L79.267 66.8481L84.0217 68.395L88.7764 69.9419L89.523 67.6469L84.7683 66.1ZM84.0217 68.395L79.3514 66.6092L79.3298 66.6659L84 68.4517L88.6702 70.2374L88.6919 70.1808L84.0217 68.395ZM84 68.4517L79.4056 66.4789C79.7307 65.7218 80.2768 65.0803 80.9724 64.6386L83.653 68.8593L86.3336 73.08C87.3373 72.4425 88.1252 71.517 88.5944 70.4244L84 68.4517ZM83.653 68.8593L80.9724 64.6386C81.6679 64.1968 82.4806 63.9753 83.3042 64.0029L83.1365 69.0001L82.9688 73.9973C84.1571 74.0372 85.3299 73.7175 86.3336 73.08L83.653 68.8593ZM83.1365 69.0001L83.3042 64.0029C84.1277 64.0306 84.9238 64.3061 85.5881 64.7935L82.6306 68.825L79.673 72.8565C80.6317 73.5598 81.7804 73.9574 82.9688 73.9973L83.1365 69.0001ZM82.6306 68.825L85.5881 64.7935C86.2525 65.2809 86.7544 65.9575 87.028 66.7347L82.3117 68.395L77.5954 70.0553C77.9902 71.1768 78.7143 72.1531 79.673 72.8565L82.6306 68.825ZM82.3117 68.395L87.0664 66.8481L86.3197 64.5531L81.565 66.1L76.8103 67.6469L77.557 69.9419L82.3117 68.395ZM81.565 66.1L86.3181 64.5481C85.9726 63.4901 85.447 62.4996 84.7645 61.6205L80.815 64.6867L76.8655 67.7529C76.842 67.7225 76.8238 67.6884 76.8119 67.6519L81.565 66.1ZM93.64 71.0217L95.1801 66.2648L93.9034 65.8514L92.3633 70.6083L90.8232 75.3652L92.0999 75.7786L93.64 71.0217ZM92.3633 70.6083L93.9487 65.8663C94.2969 65.9827 94.6132 66.1785 94.8726 66.4382L91.3353 69.972L87.798 73.5058C88.6348 74.3434 89.655 74.9749 90.778 75.3503L92.3633 70.6083ZM91.3353 69.972L94.8726 66.4382C95.1321 66.698 95.3275 67.0145 95.4436 67.3627L90.7 68.9433L85.9564 70.5239C86.3307 71.6472 86.9612 72.6681 87.798 73.5058L91.3353 69.972ZM90.7 68.9433L95.4521 67.3883L95.0354 66.115L90.2833 67.67L85.5313 69.225L85.9479 70.4983L90.7 68.9433ZM90.2833 67.67L95.0019 66.0161C94.6246 64.9396 93.9221 64.0071 92.9918 63.3474L90.0995 67.4259L87.2072 71.5045C86.4471 70.9654 85.8731 70.2035 85.5648 69.3239L90.2833 67.67ZM90.0995 67.4259L92.9918 63.3474C92.0614 62.6876 90.949 62.3332 89.8083 62.3332V67.3332V72.3332C88.8763 72.3332 87.9674 72.0436 87.2072 71.5045L90.0995 67.4259ZM89.8083 67.3332V62.3332C88.6677 62.3332 87.5553 62.6876 86.6249 63.3474L89.5172 67.4259L92.4095 71.5045C91.6492 72.0436 90.7403 72.3332 89.8083 72.3332V67.3332ZM89.5172 67.4259L86.6249 63.3474C85.6945 64.0071 84.9921 64.9397 84.6148 66.0161L89.3333 67.67L94.0519 69.3239C93.7436 70.2034 93.1697 70.9654 92.4095 71.5045L89.5172 67.4259ZM89.3333 67.67L84.5776 66.1263L84.1643 67.3996L88.92 68.9433L93.6757 70.4871L94.0891 69.2137L89.3333 67.67ZM88.92 68.9433L84.1708 67.3797C84.2847 67.0337 84.477 66.7186 84.7326 66.459L88.2948 69.9677L91.857 73.4764C92.6816 72.6393 93.3018 71.6231 93.6692 70.507L88.92 68.9433ZM88.2948 69.9677L84.7326 66.459C84.9883 66.1995 85.3004 66.0025 85.6447 65.8833L87.28 70.6083L88.9153 75.3334C90.0257 74.949 91.0324 74.3136 91.857 73.4764L88.2948 69.9677ZM87.28 70.6083L85.7381 65.852L84.4631 66.2654L86.005 71.0217L87.5469 75.778L88.8219 75.3646L87.28 70.6083ZM86.005 71.0217L84.3511 66.3031C83.2747 66.6804 82.3421 67.3828 81.6823 68.3132L85.7609 71.2055L89.8395 74.0978C89.3004 74.858 88.5384 75.4319 87.6589 75.7402L86.005 71.0217ZM85.7609 71.2055L81.6823 68.3132C81.0226 69.2436 80.6682 70.3561 80.6682 71.4967H85.6682H90.6682C90.6682 72.4286 90.3786 73.3376 89.8395 74.0978L85.7609 71.2055ZM85.6682 71.4967H80.6682C80.6682 72.6373 81.0226 73.7497 81.6823 74.6801L85.7609 71.7878L89.8395 68.8955C90.3786 69.6558 90.6682 70.5647 90.6682 71.4967H85.6682ZM85.7609 71.7878L81.6823 74.6801C82.3421 75.6105 83.2747 76.3129 84.3511 76.6902L86.005 71.9717L87.6589 67.2531C88.5384 67.5614 89.3004 68.1354 89.8395 68.8955L85.7609 71.7878ZM86.005 71.9717L84.4575 76.7262L85.7325 77.1412L87.28 72.3867L88.8275 67.6322L87.5525 67.2172L86.005 71.9717ZM87.28 72.3867L85.6982 77.1299C85.349 77.0134 85.0318 76.8171 84.7718 76.5566L88.3108 73.0246L91.8499 69.4926C91.0112 68.6522 89.9881 68.0191 88.8618 67.6435L87.28 72.3867ZM88.3108 73.0246L84.7718 76.5566C84.5117 76.296 84.3161 75.9784 84.2003 75.629L88.9467 74.0567L93.693 72.4844C93.3197 71.3573 92.6886 70.3329 91.8499 69.4926L88.3108 73.0246ZM88.9467 74.0567L84.1909 75.6004L84.6043 76.8737L89.36 75.33L94.1157 73.7863L93.7024 72.5129L88.9467 74.0567ZM89.36 75.33L84.6415 76.9839C85.0188 78.0604 85.7212 78.9929 86.6516 79.6527L89.5438 75.5741L92.4361 71.4955C93.1963 72.0346 93.7702 72.7965 94.0785 73.6761L89.36 75.33ZM89.5438 75.5741L86.6516 79.6527C87.5819 80.3124 88.6944 80.6668 89.835 80.6668V75.6668V70.6668C90.767 70.6668 91.6759 70.9564 92.4361 71.4955L89.5438 75.5741ZM89.835 75.6668V80.6668C90.9756 80.6668 92.088 80.3124 93.0184 79.6527L90.1262 75.5741L87.2339 71.4955C87.9941 70.9564 88.903 70.6668 89.835 70.6668V75.6668ZM90.1262 75.5741L93.0184 79.6527C93.9488 78.9929 94.6513 78.0603 95.0285 76.9839L90.31 75.33L85.5915 73.6761C85.8997 72.7966 86.4737 72.0346 87.2339 71.4955L90.1262 75.5741ZM90.31 75.33L95.0639 76.8794L95.4789 75.606L90.725 74.0567L85.9711 72.5073L85.5561 73.7806L90.31 75.33ZM90.725 74.0567L95.4682 75.6385C95.352 75.9869 95.1563 76.3035 94.8966 76.5632L91.361 73.0277L87.8255 69.4922C86.9878 70.3299 86.3566 71.351 85.9818 72.4749L90.725 74.0567ZM91.361 73.0277L94.8966 76.5632C94.6368 76.823 94.3202 77.0187 93.9718 77.1349L92.39 72.3917L90.8082 67.6485C89.6844 68.0233 88.6632 68.6545 87.8255 69.4922L91.361 73.0277ZM92.39 72.3917L93.9319 77.148L95.2069 76.7346L93.665 71.9783L92.1231 67.222L90.8481 67.6354L92.39 72.3917ZM93.665 71.9783L95.3189 76.6969C96.3953 76.3196 97.3279 75.6172 97.9877 74.6868L93.9091 71.7945L89.8305 68.9022C90.3696 68.142 91.1316 67.5681 92.0111 67.2598L93.665 71.9783ZM93.9091 71.7945L97.9877 74.6868C98.6474 73.7564 99.0018 72.6439 99.0018 71.5033H94.0018H89.0018C89.0018 70.5714 89.2914 69.6624 89.8305 68.9022L93.9091 71.7945ZM94.0018 71.5033H99.0018C99.0018 70.3627 98.6474 69.2503 97.9877 68.3199L93.9091 71.2122L89.8305 74.1045C89.2914 73.3443 89.0018 72.4353 89.0018 71.5033H94.0018ZM93.9091 71.2122L97.9877 68.3199C97.3279 67.3895 96.3953 66.6871 95.3189 66.3098L93.665 71.0283L92.0111 75.7469C91.1316 75.4386 90.3696 74.8646 89.8305 74.1045L93.9091 71.2122ZM93.665 71.0283L94.9533 66.1972L94.9283 66.1905L93.64 71.0217L92.3517 75.8529L92.3767 75.8595L93.665 71.0283ZM74 57.3333V62.3333C75.1265 62.3333 76.2064 62.4908 77.2211 62.7816L78.5983 57.975L79.9756 53.1684C78.0703 52.6225 76.0635 52.3333 74 52.3333V57.3333ZM78.5983 57.975L75.967 53.7234C76.0959 53.6436 76.2335 53.5787 76.377 53.53L77.9833 58.265L79.5896 63C80.1638 62.8052 80.714 62.5457 81.2296 62.2266L78.5983 57.975ZM77.9833 58.265L76.4235 53.5145L74.1901 54.2479L75.75 58.9983L77.3099 63.7488L79.5432 63.0155L77.9833 58.265ZM75.75 58.9983L74.0709 54.2887C72.747 54.7607 71.5763 55.5839 70.6843 56.6701L74.5483 59.8433L78.4123 63.0166C78.1534 63.3319 77.8135 63.5709 77.4292 63.7079L75.75 58.9983ZM74.5483 59.8433L74.7419 54.8471C72.1643 54.7472 69.593 55.1687 67.1822 56.0863L68.9608 60.7593L70.7393 65.4323C71.8923 64.9934 73.122 64.7918 74.3548 64.8396L74.5483 59.8433ZM68.9608 60.7593L67.1822 56.0863C64.7714 57.0038 62.5706 58.3986 60.7117 60.187L64.1782 63.7902L67.6447 67.3935C68.5338 66.5381 69.5863 65.8711 70.7393 65.4323L68.9608 60.7593ZM64.1782 63.7902L60.7117 60.187C58.8528 61.9754 57.374 64.1206 56.3639 66.4942L60.9646 68.452L65.5653 70.4099C66.0484 69.2748 66.7557 68.2488 67.6447 67.3935L64.1782 63.7902ZM60.9646 68.452L56.3639 66.4942C55.3538 68.8677 54.8332 71.4207 54.8333 74.0002L59.8333 74L64.8333 73.9998C64.8333 72.7661 65.0823 71.5451 65.5653 70.4099L60.9646 68.452ZM59.8333 74H54.8333C54.8333 77.3053 55.6744 80.499 57.2558 83.3321L61.6217 80.895L65.9875 78.4579C65.2357 77.111 64.8333 75.5947 64.8333 74H59.8333ZM61.6217 80.895L57.2509 83.3232L57.5009 83.7732L61.8717 81.345L66.2425 78.9168L65.9925 78.4668L61.6217 80.895ZM61.8717 81.345L57.0557 80.0008L55.2024 86.6408L60.0183 87.985L64.8343 89.3292L66.6876 82.6892L61.8717 81.345ZM60.0183 87.985L61.3616 92.8012L68.0066 90.9479L66.6633 86.1317L65.3201 81.3155L58.6751 83.1688L60.0183 87.985ZM66.6633 86.1317L64.2351 90.5024L64.6851 90.7524L67.1133 86.3817L69.5416 82.0109L69.0916 81.7609L66.6633 86.1317ZM67.1133 86.3817L64.6832 90.7514C67.3556 92.2376 70.3448 93.063 73.4012 93.1585L73.5575 88.161L73.7138 83.1634C72.2517 83.1177 70.8218 82.7229 69.5435 82.012L67.1133 86.3817ZM73.5575 88.161L73.4012 93.1585C76.4577 93.2541 79.4926 92.6171 82.2527 91.3007L80.1003 86.7877L77.9479 82.2747C76.6276 82.9044 75.1758 83.2091 73.7138 83.1634L73.5575 88.161ZM80.1003 86.7877L82.2527 91.3007C85.0127 89.9844 87.4178 88.0268 89.2672 85.5915L85.2852 82.5676L81.3033 79.5437C80.4186 80.7087 79.2681 81.6451 77.9479 82.2747L80.1003 86.7877ZM85.2852 82.5676L89.2672 85.5915C91.1166 83.1562 92.3565 80.3139 92.8835 77.3017L87.9583 76.44L83.0331 75.5783C82.7811 77.0192 82.1879 78.3788 81.3033 79.5437L85.2852 82.5676ZM87.9583 76.44L83.8108 79.2324C84.2954 79.9523 84.8989 80.5724 85.5989 81.0754L88.5167 77.015L91.4344 72.9546C91.6922 73.1398 91.9235 73.3766 92.1059 73.6476L87.9583 76.44ZM88.5167 77.015L85.609 81.0826C86.4726 81.7 87.4629 82.1173 88.5078 82.3042L89.3884 77.3823L90.2689 72.4605C90.6854 72.535 91.0801 72.7013 91.4244 72.9474L88.5167 77.015ZM89.3884 77.3823L88.5078 82.3042C89.5528 82.4911 90.6263 82.4431 91.6504 82.1634L90.3333 77.34L89.0162 72.5166C89.4244 72.4051 89.8523 72.386 90.2689 72.4605L89.3884 77.3823ZM90.3333 77.34L85.4341 76.3415C84.349 81.6654 79.6353 85.6667 74 85.6667V90.6667V95.6667C84.4847 95.6667 93.2177 88.2246 95.2326 78.3385L90.3333 77.34ZM74 90.6667L73.9931 85.6667C72.1343 85.6692 70.3021 85.2251 68.6508 84.3716L66.355 88.8133L64.0592 93.2551C67.134 94.8444 70.5457 95.6714 74.0069 95.6667L74 90.6667ZM66.355 88.8133L65.0118 83.9971L58.6352 85.7755L59.9783 90.5917L61.3215 95.4079L67.6982 93.6296L66.355 88.8133ZM59.9783 90.5917L58.6343 85.7757C59.1324 85.6367 59.6584 85.6326 60.1586 85.7639L58.8895 90.6001L57.6205 95.4364C58.8352 95.7551 60.1128 95.7452 61.3224 95.4076L59.9783 90.5917ZM58.8895 90.6001L60.1586 85.7639C60.6588 85.8951 61.1151 86.157 61.4807 86.5226L57.9452 90.0582L54.4096 93.5937C55.2976 94.4817 56.4057 95.1176 57.6205 95.4364L58.8895 90.6001ZM57.9452 90.0582L61.4807 86.5226C61.8464 86.8883 62.1082 87.3446 62.2395 87.8447L57.4032 89.1138L52.5669 90.3829C52.8857 91.5976 53.5217 92.7057 54.4096 93.5937L57.9452 90.0582ZM57.4032 89.1138L62.2395 87.8447C62.3707 88.3449 62.3666 88.871 62.2276 89.369L57.4117 88.025L52.5957 86.681C52.2581 87.8906 52.2482 89.1682 52.5669 90.3829L57.4032 89.1138ZM57.4117 88.025L62.2273 89.3703L64.0073 82.9986L59.1917 81.6533L54.3761 80.308L52.5961 86.6797L57.4117 88.025ZM59.1917 81.6533L63.6319 79.3546C62.7763 77.7019 62.3309 75.8676 62.3333 74.0065L57.3333 74L52.3333 73.9935C52.3288 77.4589 53.1582 80.8746 54.7514 83.9521L59.1917 81.6533ZM57.3333 74H62.3333C62.3333 67.5564 67.5564 62.3333 74 62.3333V57.3333V52.3333C62.0336 52.3333 52.3333 62.0336 52.3333 74H57.3333Z" fill="#22C75E" mask="url(#path-3-inside-1_5_2)"/>
              </g>
              <defs>
              <filter id="filter0_d_5_2" x="0" y="0" width="149" height="149" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
              <feFlood floodOpacity="0" result="BackgroundImageFix"/>
              <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
              <feOffset/>
              <feGaussianBlur stdDeviation="15"/>
              <feComposite in2="hardAlpha" operator="out"/>
              <feColorMatrix type="matrix" values="0 0 0 0 0.133333 0 0 0 0 0.780392 0 0 0 0 0.368627 0 0 0 0.25 0"/>
              <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_5_2"/>
              <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_5_2" result="shape"/>
              </filter>
              <filter id="filter1_d_5_2" x="27.3333" y="23.9977" width="96.6685" height="96.6707" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
              <feFlood floodOpacity="0" result="BackgroundImageFix"/>
              <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
              <feOffset/>
              <feGaussianBlur stdDeviation="15"/>
              <feComposite in2="hardAlpha" operator="out"/>
              <feColorMatrix type="matrix" values="0 0 0 0 0.133333 0 0 0 0 0.780392 0 0 0 0 0.368627 0 0 0 0.25 0"/>
              <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_5_2"/>
              <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_5_2" result="shape"/>
              </filter>
              </defs>
              </svg>
          </button>
        </div>
      </>
    );
  }
  
  // Return the expanded state UI
  return (
    <>
      <style>{styles}</style>
      <div className="abra-container">
        <div className="abra-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <h3 style={{ 
              margin: 0, 
              fontFamily: "'Krona One', sans-serif", 
              fontSize: '1.5rem', 
              fontWeight: 'bold', 
              color: '#f0f0f0',
              letterSpacing: '-0.02em' 
            }}>
              Abra Assistant
            </h3>
          </div>
          <button 
            className="abra-close-button" 
            onClick={toggleExpanded}
            aria-label="Close Abra Assistant"
          >
            ×
          </button>
        </div>
        <div ref={contentRef} className="abra-content">
          <div className="abra-message-container">
            <div className="abra-message abra-welcome-message" >
              <strong>Hi there! I'm Abra</strong>
              <p>I can execute actions on your behalf to help you get things done quickly.</p>
            </div>

            {suggested.length > 0 && (
              <div className="abra-message">
                <strong>Try Abra with some of our favorites:</strong>
                <ul style={{ marginTop: '8px', paddingLeft: '20px' }}>
                  {suggested.map((example, index) => (
                    <li 
                      key={index} 
                      onClick={() => updateState({ input: example })}
                    >
                      {example}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {state.isProcessing && (
              <div className="abra-thinking-container">
                {processingSteps.map((step, index) => (
                  <div key={index} className="abra-thinking-step">
                    {state.processingStep > index ? (
                      <span className="abra-step-checkmark">✓</span>
                    ) : state.processingStep === index ? (
                      <span className="abra-loader"></span>
                    ) : (
                      <span style={{width: '20px'}}></span>
                    )}
                    {step}
                  </div>
                ))}
              </div>
            )}

            {state.status && !state.isProcessing && !state.error && !state.showSuccess && (
              <div className="abra-message">
                {state.status}
              </div>
            )}

            {state.error && (
              <div className="abra-message error-message">
                {state.error}
              </div>
            )}

            {state.result && !state.error && (
              <div className="abra-message result-message">
                {typeof state.result === 'string'
                  ? state.result
                  : JSON.stringify(state.result, null, 2)}
              </div>
            )}

            {state.showSuccess && !state.error && (
              <div className="abra-success-message">
                <div className="abra-success-icon">✓</div>
                Operation completed successfully
              </div>
            )}
          </div>

          <form onSubmit={handleSubmit} className="abra-input-container">
            <textarea
              ref={textInputRef}
              placeholder="Type what you want to do..."
              value={state.input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              className="abra-input"
              readOnly={state.isLoading}
              rows={1}
            />
            <button 
              type="submit" 
              className="abra-send-button"
              aria-label="Send message"
              disabled={state.isLoading || !state.input.trim()}
            >
              <ArrowIcon />
            </button>
          </form>
        </div>
      </div>
    </>
  );
};

export default AbraAssistant;