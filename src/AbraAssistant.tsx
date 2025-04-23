import React, { useState, useEffect, useRef } from "react";

const BACKEND_URL = "https://api.abra-actions.com";

type ActionDefinition = {
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

export interface AbraConfig {
    apiKey: string;
    actionRegistry: Record<string, (params: any) => Promise<any>>;
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

const AbraAssistant: React.FC<AbraAssistantProps> = ({ config }) => {
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

  const execute = async (name: string, params: any) => {
    const fn = actionRegistry[name];
    if (!fn) throw new Error(`Action "${name}" not found`);
    try {
      const result = await fn(params);
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
      error: null
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
          status: `Successfully executed: ${aiResponse.action}`,
          input: '',
          previousContext: null, 
          showSuccess: true
        });
  
        setTimeout(() => {
          updateState({ showSuccess: false });
          textInputRef.current?.focus();
        }, 4000);
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
  
  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Krona+One&display=swap');
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
    
    .abra-container {
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      width: 380px !important;
      max-width: calc(100% - 48px) !important;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      border-radius: 12px !important;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(74, 229, 131, 0.15) !important;
      background-color: rgba(14, 14, 14, 0.95) !important;
      backdrop-filter: blur(10px) !important;
      overflow: hidden !important;
      z-index: 10000 !important;
      animation: fadeIn 0.3s ease-out !important;
      color: #f0f0f0 !important;
    }
    
    .abra-header {
      padding: 16px 18px !important;
      border-bottom: 1px solid rgba(74, 229, 131, 0.15) !important;
      display: flex !important;
      align-items: center !important;
      justify-content: space-between !important;
      background-color: #121212 !important;
    }
    
    .abra-title {
      margin: 0 !important;
      color: #f0f0f0 !important;
      font-size: 1.25rem !important;
      font-weight: 500 !important;
      font-family: 'Krona One', sans-serif !important;
      letter-spacing: -0.02em !important;
    }
    
    .abra-close-button {
      background: rgba(40, 40, 40, 0.95) !important;
      border: none !important;
      color: #f0f0f0 !important;
      font-size: 1.5rem !important;
      cursor: pointer !important;
      padding: 0 !important;
      transition: color 0.2s ease !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 32px !important;
      height: 32px !important;
      border-radius: 50% !important;
    }
    
    .abra-close-button:hover {
      color: #4AE583 !important;
    }
    
    .abra-content {
      padding: 16px !important;
      background-color: #111111 !important;
      max-height: 60vh !important;
      overflow-y: auto !important;
      transition: max-height 0.3s ease-out !important;
      color: #f0f0f0 !important;
    }
    
    .abra-message-container {
      margin-bottom: 16px !important;
    }
    
    .abra-message {
      background-color: rgba(40, 40, 40, 0.6) !important;
      color: #f0f0f0 !important;
      padding: 12px 16px !important;
      border-radius: 8px !important;
      margin-bottom: 12px !important;
      font-size: 0.95rem !important;
      line-height: 1.5 !important;
      backdrop-filter: blur(4px) !important;
      border: 1px solid rgba(255, 255, 255, 0.03) !important;
    }
    
    .abra-message strong {
      color: #fff !important;
      font-family: 'Krona One', sans-serif !important;
      font-size: 0.9rem !important;
      letter-spacing: -0.01em !important;
    }
    
    .error-message {
      background: linear-gradient(135deg, rgba(255, 82, 82, 0.08) 0%, rgba(255, 82, 82, 0.02) 100%) !important;
      border: none !important;
      position: relative !important;
      color: #ff8a8a !important;
      box-shadow: 0 4px 12px rgba(255, 82, 82, 0.15) !important;
      overflow: hidden !important;
    }
    
    .error-message::before {
      content: "" !important;
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      width: 4px !important;
      height: 100% !important;
      background: linear-gradient(to bottom, #ff5252, rgba(255, 82, 82, 0.5)) !important;
    }
    
    .result-message {
      background-color: rgba(40, 40, 40, 0.7) !important;
      font-family: monospace !important;
    }
    
    .abra-thinking-container {
      margin: 12px 0 !important;
      background: rgba(0, 0, 0, 0.2) !important;
      border-radius: 8px !important;
      padding: 12px !important;
      border: 1px solid rgba(255, 255, 255, 0.03) !important;
    }
    
    .abra-thinking-step {
      color: #aaa !important;
      font-size: 0.9rem !important;
      display: flex !important;
      align-items: center !important;
      margin-bottom: 8px !important;
    }
    
    .abra-step-checkmark {
      color: #4AE583 !important;
      margin-right: 8px !important;
      display: inline-flex !important;
      align-items: center !important;
      justify-content: center !important;
      width: 18px !important;
      height: 18px !important;
    }
    
    .abra-loader {
      border: 2px solid rgba(74, 229, 131, 0.1) !important;
      border-top: 2px solid #4AE583 !important;
      border-right: 2px solid #4AE583 !important;
      border-radius: 50% !important;
      width: 14px !important;
      height: 14px !important;
      animation: spin 0.8s linear infinite !important;
      margin-right: 8px !important;
    }
    
    .abra-success-message {
      background: linear-gradient(135deg, rgba(74, 229, 131, 0.08) 0%, rgba(74, 229, 131, 0.02) 100%) !important;
      border: none !important;
      color: #4AE583 !important;
      border-radius: 8px !important;
      padding: 16px !important;
      margin: 12px 0 !important;
      position: relative !important;
      backdrop-filter: blur(4px) !important;
      box-shadow: 0 4px 12px rgba(74, 229, 131, 0.1) !important;
      overflow: hidden !important;
      display: flex !important;
      align-items: center !important;
    }
    
    .abra-success-message::before {
      content: "" !important;
      position: absolute !important;
      top: 0 !important;
      left: 0 !important;
      width: 4px !important;
      height: 100% !important;
      background: linear-gradient(to bottom, #4AE583, rgba(74, 229, 131, 0.5)) !important;
    }
    
    .abra-success-icon {
      margin-right: 8px !important;
      width: 20px !important;
      height: 20px !important;
      background: rgba(74, 229, 131, 0.2) !important;
      border-radius: 50% !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
    }
    
    .abra-input-container {
      display: flex !important;
      margin-top: 8px !important;
      position: relative !important;
    }
    
    .abra-input {
      flex: 1 !important;
      padding: 12px 46px 12px 16px !important;
      border-radius: 12px !important;
      border: 1px solid rgba(255, 255, 255, 0.08) !important;
      background-color: rgba(20, 20, 20, 0.8) !important;
      color: #f0f0f0 !important;
      font-size: 0.95rem !important;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      min-height: 46px !important;
      height: auto !important;
      max-height: 120px !important;
      overflow-y: auto !important;
      resize: none !important;
      transition: border-color 0.2s ease, min-height 0.2s ease, box-shadow 0.2s ease !important;
    }
    
    .abra-input:focus {
      outline: none !important;
      border-color: rgba(74, 229, 131, 0.5) !important;
      box-shadow: 0 0 0 2px rgba(74, 229, 131, 0.1), 0 2px 8px rgba(0, 0, 0, 0.1) !important;
    }
    
    .abra-send-button {
      position: absolute !important;
      right: 8px !important;
      top: 50% !important;
      transform: translateY(-50%) !important;
      background: rgba(74, 229, 131, 0.9) !important;
      border: none !important;
      border-radius: 8px !important;
      width: 30px !important;
      height: 30px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      cursor: pointer !important;
      transition: transform 0.2s ease, background-color 0.2s ease !important;
    }
    
    .abra-send-button:hover {
      transform: translateY(-50%) scale(1.05) !important;
      background-color: #4AE583 !important;
    }
    
    .abra-send-button:disabled {
      opacity: 0.5 !important;
      cursor: not-allowed !important;
      background-color: rgba(74, 229, 131, 0.3) !important;
    }
    
    .abra-chat-button {
      position: fixed !important;
      bottom: 24px !important;
      right: 24px !important;
      z-index: 10000 !important;
      background: transparent !important;
    }
    
    .abra-chat-button-inner {
      background: transparent !important;
      border: none !important;
      padding: 0 !important;
      margin: 0 !important;
      cursor: pointer !important;
      transition: transform 0.2s ease !important;
      outline: none !important; 
      box-shadow: none !important;
    }
    
    .abra-chat-button-inner svg {
      display: block !important; 
    }
    
    .abra-chat-button-inner:hover {
      transform: scale(1.05) !important;
    }
    
    .abra-tooltip {
      position: absolute !important;
      bottom: 100% !important;
      right: 0 !important;
      margin-bottom: 10px !important;
      white-space: nowrap !important;
      background: rgba(18, 18, 18, 0.95) !important;
      color: #f0f0f0 !important;
      padding: 8px 12px !important;
      border-radius: 8px !important;
      font-size: 14px !important;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2) !important;
      pointer-events: none !important;
      opacity: 0.9 !important;
      transform: translateY(10px) !important;
      transition: opacity 0.3s, transform 0.3s !important;
      border: 1px solid rgba(74, 229, 131, 0.2) !important;
      z-index: 10001 !important;
    }
    
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
    
    @media (max-width: 480px) {
      .abra-container {
        width: calc(100% - 32px) !important;
        right: 16px !important;
        bottom: 16px !important;
      }
    }
  `;

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
            <div className="abra-tooltip">
              <span className="abra-tooltip-icon">💬</span>
              Chat with Abra Now!
            </div>
            <svg width="110" height="110" viewBox="0 0 149 149" fill="none" xmlns="http://www.w3.org/2000/svg">
              <g filter="url(#filter0_d_5_2)">
              <path d="M119 74.5C119 99.0767 99.0767 119 74.5 119C49.9233 119 30 99.0767 30 74.5C30 49.9233 49.9233 30 74.5 30C99.0767 30 119 49.9233 119 74.5Z" fill="#232323"/>
              <path d="M74.5 31C98.5244 31 118 50.4756 118 74.5C118 98.5244 98.5244 118 74.5 118C50.4756 118 31 98.5244 31 74.5C31 50.4756 50.4756 31 74.5 31Z" stroke="#22C75E" strokeWidth="2"/>
              </g>
              <g filter="url(#filter1_d_5_2)">
              <mask id="path-3-inside-1_5_2" fill="white">
              <path d="M80.8133 64.6867C80.2392 63.9455 79.4578 63.3915 78.5683 63.095L76.2717 62.3483C76.0953 62.2856 75.9428 62.1698 75.8349 62.0168C75.727 61.8639 75.669 61.6813 75.669 61.4942C75.669 61.307 75.727 61.1244 75.8349 60.9715C75.9428 60.8186 76.0953 60.7028 76.2717 60.64L78.5683 59.8933C79.2479 59.6586 79.8652 59.2722 80.3731 58.7634C80.8811 58.2545 81.2665 57.6367 81.5 56.9567L81.5183 56.9L82.265 54.605C82.3271 54.4275 82.4428 54.2737 82.5961 54.1649C82.7494 54.0561 82.9328 53.9977 83.1208 53.9977C83.3089 53.9977 83.4922 54.0561 83.6456 54.1649C83.7989 54.2737 83.9146 54.4275 83.9767 54.605L84.7217 56.9C84.9546 57.5976 85.3468 58.2313 85.8672 58.7509C86.3877 59.2705 87.022 59.6616 87.72 59.8933L90.015 60.64L90.0617 60.6517C90.238 60.7144 90.3906 60.8302 90.4985 60.9832C90.6064 61.1361 90.6643 61.3187 90.6643 61.5058C90.6643 61.693 90.6064 61.8756 90.4985 62.0285C90.3906 62.1814 90.238 62.2972 90.0617 62.36L87.765 63.1067C87.0674 63.3386 86.4333 63.7299 85.9132 64.2494C85.393 64.769 85.0011 65.4026 84.7683 66.1L84.0217 68.395L84 68.4517C83.928 68.6194 83.807 68.7614 83.653 68.8593C83.4989 68.9571 83.3189 69.0062 83.1365 69.0001C82.9541 68.994 82.7777 68.9329 82.6306 68.825C82.4834 68.717 82.3723 68.5672 82.3117 68.395L81.565 66.1C81.3982 65.5892 81.1445 65.1111 80.815 64.6867M93.64 71.0217L92.3633 70.6083C91.9759 70.4788 91.624 70.261 91.3353 69.972C91.0466 69.683 90.8291 69.3309 90.7 68.9433L90.2833 67.67C90.2488 67.5716 90.1846 67.4863 90.0995 67.4259C90.0144 67.3656 89.9127 67.3332 89.8083 67.3332C89.704 67.3332 89.6023 67.3656 89.5172 67.4259C89.4321 67.4863 89.3678 67.5716 89.3333 67.67L88.92 68.9433C88.7932 69.3284 88.5793 69.6789 88.2948 69.9677C88.0104 70.2565 87.6631 70.4758 87.28 70.6083L86.005 71.0217C85.9066 71.0562 85.8213 71.1204 85.7609 71.2055C85.7006 71.2906 85.6682 71.3924 85.6682 71.4967C85.6682 71.601 85.7006 71.7027 85.7609 71.7878C85.8213 71.8729 85.9066 71.9372 86.005 71.9717L87.28 72.3867C87.6685 72.5162 88.0215 72.7347 88.3108 73.0246C88.6002 73.3145 88.8179 73.6679 88.9467 74.0567L89.36 75.33C89.3945 75.4285 89.4588 75.5137 89.5438 75.5741C89.6289 75.6344 89.7307 75.6668 89.835 75.6668C89.9393 75.6668 90.0411 75.6344 90.1262 75.5741C90.2112 75.5137 90.2755 75.4285 90.31 75.33L90.725 74.0567C90.8543 73.669 91.072 73.3167 91.361 73.0277C91.65 72.7387 92.0023 72.521 92.39 72.3917L93.665 71.9783C93.7634 71.9438 93.8487 71.8796 93.9091 71.7945C93.9694 71.7094 94.0018 71.6077 94.0018 71.5033C94.0018 71.399 93.9694 71.2973 93.9091 71.2122C93.8487 71.1271 93.7634 71.0628 93.665 71.0283L93.64 71.0217Z"/>
              </mask>
              <path d="M80.8133 64.6867C80.2392 63.9455 79.4578 63.3915 78.5683 63.095L76.2717 62.3483C76.0953 62.2856 75.9428 62.1698 75.8349 62.0168C75.727 61.8639 75.669 61.6813 75.669 61.4942C75.669 61.307 75.727 61.1244 75.8349 60.9715C75.9428 60.8186 76.0953 60.7028 76.2717 60.64L78.5683 59.8933C79.2479 59.6586 79.8652 59.2722 80.3731 58.7634C80.8811 58.2545 81.2665 57.6367 81.5 56.9567L81.5183 56.9L82.265 54.605C82.3271 54.4275 82.4428 54.2737 82.5961 54.1649C82.7494 54.0561 82.9328 53.9977 83.1208 53.9977C83.3089 53.9977 83.4922 54.0561 83.6456 54.1649C83.7989 54.2737 83.9146 54.4275 83.9767 54.605L84.7217 56.9C84.9546 57.5976 85.3468 58.2313 85.8672 58.7509C86.3877 59.2705 87.022 59.6616 87.72 59.8933L90.015 60.64L90.0617 60.6517C90.238 60.7144 90.3906 60.8302 90.4985 60.9832C90.6064 61.1361 90.6643 61.3187 90.6643 61.5058C90.6643 61.693 90.6064 61.8756 90.4985 62.0285C90.3906 62.1814 90.238 62.2972 90.0617 62.36L87.765 63.1067C87.0674 63.3386 86.4333 63.7299 85.9132 64.2494C85.393 64.769 85.0011 65.4026 84.7683 66.1L84.0217 68.395L84 68.4517C83.928 68.6194 83.807 68.7614 83.653 68.8593C83.4989 68.9571 83.3189 69.0062 83.1365 69.0001C82.9541 68.994 82.7777 68.9329 82.6306 68.825C82.4834 68.717 82.3723 68.5672 82.3117 68.395L81.565 66.1C81.3982 65.5892 81.1445 65.1111 80.815 64.6867M93.64 71.0217L92.3633 70.6083C91.9759 70.4788 91.624 70.261 91.3353 69.972C91.0466 69.683 90.8291 69.3309 90.7 68.9433L90.2833 67.67C90.2488 67.5716 90.1846 67.4863 90.0995 67.4259C90.0144 67.3656 89.9127 67.3332 89.8083 67.3332C89.704 67.3332 89.6023 67.3656 89.5172 67.4259C89.4321 67.4863 89.3678 67.5716 89.3333 67.67L88.92 68.9433C88.7932 69.3284 88.5793 69.6789 88.2948 69.9677C88.0104 70.2565 87.6631 70.4758 87.28 70.6083L86.005 71.0217C85.9066 71.0562 85.8213 71.1204 85.7609 71.2055C85.7006 71.2906 85.6682 71.3924 85.6682 71.4967C85.6682 71.601 85.7006 71.7027 85.7609 71.7878C85.8213 71.8729 85.9066 71.9372 86.005 71.9717L87.28 72.3867C87.6685 72.5162 88.0215 72.7347 88.3108 73.0246C88.6002 73.3145 88.8179 73.6679 88.9467 74.0567L89.36 75.33C89.3945 75.4285 89.4588 75.5137 89.5438 75.5741C89.6289 75.6344 89.7307 75.6668 89.835 75.6668C89.9393 75.6668 90.0411 75.6344 90.1262 75.5741C90.2112 75.5137 90.2755 75.4285 90.31 75.33L90.725 74.0567C90.8543 73.669 91.072 73.3167 91.361 73.0277C91.65 72.7387 92.0023 72.521 92.39 72.3917L93.665 71.9783C93.7634 71.9438 93.8487 71.8796 93.9091 71.7945C93.9694 71.7094 94.0018 71.6077 94.0018 71.5033C94.0018 71.399 93.9694 71.2973 93.9091 71.2122C93.8487 71.1271 93.7634 71.0628 93.665 71.0283L93.64 71.0217Z" fill="#22C75E"/>
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
            <div className="abra-message" style={{ 
              background: '#1e2b1e', 
              borderLeft: '4px solid #4AE583',
              borderRadius: '8px'
            }}>
              <strong>Hi there! I'm Abra</strong>
              <p>I can execute actions on your behalf to help you get things done quickly.</p>
            </div>

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