import React, { useState, useRef, useEffect } from "react";
import { executeAction, getAllActions } from "../core/executor";
import { fetchLLMResponse, fetchSuggestedActions } from "../core/llm";
import "../AbraAssistant.css";

export function AbraActionPrompt() {
    const [input, setInput] = useState("");
    const [status, setStatus] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [actions, setActions] = useState([]);
    const [expanded, setExpanded] = useState(false);
    const [showThinking, setShowThinking] = useState(false);
    const [thinkingSteps, setThinkingSteps] = useState([]);
    const [currentThinkingStep, setCurrentThinkingStep] = useState(0);
    const [showSuccess, setShowSuccess] = useState(false);
    const [suggestedActions, setSuggestedActions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const textInputRef = useRef(null);
    const contentRef = useRef(null);

    useEffect(() => {
        setActions(getAllActions());
    }, []);

    useEffect(() => {
        if (expanded && textInputRef.current) {
            textInputRef.current.focus();
        }
    }, [expanded]);

    useEffect(() => {
        const adjustHeight = () => {
            if (contentRef.current && expanded) {
                const contentHeight = contentRef.current.scrollHeight;
                const maxHeight = window.innerHeight * 0.8;
                const minHeight = 300;
                
                contentRef.current.style.maxHeight = Math.max(minHeight, Math.min(contentHeight + 40, maxHeight)) + 'px';
                
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
    }, [expanded, showThinking, currentThinkingStep, showSuccess, showSuggestions]);

    const handleExecute = async () => {
        if (!input.trim()) {
            setStatus("⚠️ Please enter a request.");
            return;
        }

        setIsLoading(true);
        setShowThinking(true);
        setCurrentThinkingStep(0);
        setResult(null);
        setError(null);
        setShowSuccess(false);
        setShowSuggestions(false);
        
        // Define thinking steps based on the user's request
        const steps = [
            "Analyzing your request...",
            "Identifying appropriate action...",
            "Validating parameters...",
            "Preparing execution...",
            "Processing request..."
        ];
        
        setThinkingSteps(steps);
        
        // Simulate thinking progress
        let currentStep = 0;
        const thinkingInterval = setInterval(() => {
            if (currentStep < steps.length - 1) {
                currentStep++;
                setCurrentThinkingStep(currentStep);
            } else {
                clearInterval(thinkingInterval);
            }
        }, 800);
        
        try {
            const aiResponse = await fetchLLMResponse(input);
            
            if (!aiResponse || !aiResponse.action) {
                // AI couldn't determine the action, so let's get suggestions
                clearInterval(thinkingInterval);
                setCurrentThinkingStep(thinkingSteps.length - 1); // Complete the thinking animation
                
                // Get suggested actions based on available actions
                try {
                    // Use the existing actions in state or getAllActions()
                    const availableActions = actions.length ? actions : getAllActions();
                    const suggestions = await fetchSuggestedActions(input, availableActions);
                    setSuggestedActions(suggestions.slice(0, 4)); // Limit to 4 suggestions
                    setShowSuggestions(true);
                    setStatus("I'm not sure what you want to do. Would you like to try one of these?");
                } catch (suggestErr) {
                    // If fetching suggestions fails, just show a generic set of actions
                    const availableActions = actions.length ? actions : getAllActions();
                    setSuggestedActions(availableActions.slice(0, 4).map(a => ({
                        name: a.name,
                        description: a.description || a.name
                    })));
                    setShowSuggestions(true);
                }
                
                setShowThinking(false);
                setIsLoading(false);
                return;
            }

            setStatus(`Selected action: ${aiResponse.action}`);
            
            // Execute the action
            const executionResult = await executeAction(aiResponse.action, aiResponse.params || {});
            
            clearInterval(thinkingInterval);
            setShowThinking(false);
            
            if (executionResult.success) {
                setResult(executionResult.result);
                setShowSuccess(true);
                setStatus(`Successfully executed: ${executionResult.action}`);
                
                // Auto-hide success message after 3 seconds
                setTimeout(() => {
                    setShowSuccess(false);
                }, 3000);
            } else {
                setError(executionResult.error || "Unknown error occurred");
                setStatus(`Execution failed: ${executionResult.error}`);
            }
        } catch (err) {
            clearInterval(thinkingInterval);
            setShowThinking(false);
            setError(err.message || "An unexpected error occurred");
            setStatus("Request failed");
        } finally {
            setIsLoading(false);
        }
    };

    const toggleExpanded = () => {
        setExpanded(!expanded);
        if (!expanded) {
            // Reset state when opening
            setInput("");
            setStatus("");
            setResult(null);
            setError(null);
            setShowThinking(false);
            setShowSuccess(false);
            setShowSuggestions(false);
            setSuggestedActions([]);
        }
    };

    const handleSuggestionClick = (suggestion) => {
        setInput(suggestion.description || suggestion.name);
        setShowSuggestions(false);
        // Let the user confirm by pressing send
        if (textInputRef.current) {
            textInputRef.current.focus();
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!input.trim() || isLoading) return;
        handleExecute();
    };

    if (!expanded) {
        return (
            <div className="abra-button-container">
                <button 
                    className="abra-circle-button" 
                    onClick={toggleExpanded}
                    aria-label="Open Abra Assistant"
                >
                    <span className="abra-at-symbol">@</span>
                </button>
            </div>
        );
    }

    return (
        <div className="abra-container">
            <div className="abra-header">
                <h3 className="abra-title">Abra Assistant</h3>
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
                    <div className="abra-message">
                        I can execute functions in this application through natural language. What would you like to do?
                    </div>

                    {showThinking && (
                        <div className="abra-thinking-container">
                            {thinkingSteps.map((step, index) => (
                                <div key={index} className="abra-thinking-step">
                                    {currentThinkingStep > index ? (
                                        <span className="abra-step-checkmark">✓</span>
                                    ) : currentThinkingStep === index ? (
                                        <span className="abra-loader"></span>
                                    ) : (
                                        <span style={{width: '20px'}}></span>
                                    )}
                                    {step}
                                </div>
                            ))}
                        </div>
                    )}

                    {error && (
                        <div className="abra-error">
                            <h4>Error</h4>
                            <p>{error}</p>
                        </div>
                    )}
                    
                    {showSuccess && result && (
                        <div className="abra-success-message">
                            ✅ Action completed successfully
                            <pre style={{marginTop: '10px', fontSize: '0.85rem'}}>{JSON.stringify(result, null, 2)}</pre>
                        </div>
                    )}
                    
                    {showSuggestions && suggestedActions.length > 0 && (
                        <div className="abra-suggestion-container">
                            {suggestedActions.map((action, index) => (
                                <button 
                                    key={index} 
                                    className="abra-suggestion-button"
                                    onClick={() => handleSuggestionClick(action)}
                                >
                                    {action.description || action.name}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                
                <form onSubmit={handleSubmit} className="abra-input-container">
                    <input
                        ref={textInputRef}
                        type="text"
                        placeholder="Type what you want to do..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        className="abra-input"
                        disabled={isLoading}
                    />
                    <button 
                        type="submit" 
                        className="abra-send-button"
                        aria-label="Send message"
                        disabled={isLoading}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{marginRight: '-1px', marginTop: '0px'}}>
                            <path d="M22 2L11 13" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="black" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                    </button>
                </form>
            </div>
        </div>
    );
}