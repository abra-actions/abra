import React, { useState } from "react";
import { executeAction, getAllActions } from "../core/executor.js";
import { fetchLLMResponse } from "../core/llm.js";

export function AbraActionPrompt() {
    const [input, setInput] = useState("");
    const [status, setStatus] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [error, setError] = useState(null);
    const [actions, setActions] = useState([]);
    const [expanded, setExpanded] = useState(false);

    React.useEffect(() => {
        setActions(getAllActions());
    }, []);

    const handleExecute = async () => {
        if (!input.trim()) {
            setStatus("⚠️ Please enter a request.");
            return;
        }

        setIsLoading(true);
        setStatus("🔍 Analyzing your request...");
        setResult(null);
        setError(null);
        
        try {
            const aiResponse = await fetchLLMResponse(input);
            
            if (!aiResponse || !aiResponse.action) {
                setError("AI couldn't determine an appropriate action for your request.");
                setStatus("⚠️ Request analysis failed.");
                setIsLoading(false);
                return;
            }

            setStatus(`🧠 Selected action: ${aiResponse.action}`);
            
            // Execute the action
            const executionResult = await executeAction(aiResponse.action, aiResponse.params || {});
            
            if (executionResult.success) {
                setResult(executionResult.result);
                setStatus(`✅ Successfully executed: ${executionResult.action}`);
            } else {
                setError(executionResult.error || "Unknown error occurred");
                setStatus(`❌ Execution failed: ${executionResult.error}`);
            }
        } catch (err) {
            setError(err.message || "An unexpected error occurred");
            setStatus("❌ Request failed");
        } finally {
            setIsLoading(false);
        }
    };

    const toggleExpanded = () => {
        setExpanded(!expanded);
    };

    return (
        <div className="abra-container">
            <div className="user-interface-mock">
                {!expanded ? (
                    <div className="collapsed-view" onClick={toggleExpanded}>
                        <div className="chat-button">
                            <span className="at-symbol">@</span>
                        </div>
                    </div>
                ) : (
                    <div className="expanded-view">
                        <div className="chat-button" onClick={toggleExpanded}>
                            <span className="at-symbol">@</span>
                        </div>
                        <div className="input-expanded">
                            <input
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                placeholder="Describe what you want to do..."
                                className="input-text"
                                disabled={isLoading}
                            />
                            <div 
                                className="send-button" 
                                onClick={handleExecute}
                                style={{opacity: isLoading ? 0.5 : 1}}
                            >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M22 2L11 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            </div>
                        </div>
                    </div>
                )}
            </div>
            
            {(status || error || result) && expanded && (
                <div className="abra-results-container">
                    {status && (
                        <div className="abra-status">
                            {status}
                        </div>
                    )}
                    
                    {error && (
                        <div className="abra-error">
                            <h4>Error</h4>
                            <p>{error}</p>
                        </div>
                    )}
                    
                    {result && (
                        <div className="abra-result">
                            <h4>Result</h4>
                            <pre>{JSON.stringify(result, null, 2)}</pre>
                        </div>
                    )}
                </div>
            )}
            
            <style jsx>{`
                .abra-container {
                    font-family: 'Roboto Mono', monospace;
                    max-width: 800px;
                    margin: 0 auto;
                    padding: 20px;
                }
                
                .user-interface-mock {
                    display: flex;
                    align-items: center;
                    position: relative;
                    margin-bottom: 15px;
                }

                .chat-button {
                    width: 40px;
                    height: 40px;
                    background-color: var(--primary, #25D366);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-right: 10px;
                    box-shadow: 0 4px 10px rgba(37, 211, 102, 0.3);
                    flex-shrink: 0;
                    cursor: pointer;
                }

                .at-symbol {
                    color: black;
                    font-weight: bold;
                    font-size: 1.2rem;
                    font-family: 'Roboto Mono', monospace;
                }

                .input-expanded {
                    display: flex;
                    align-items: center;
                    background-color: var(--surface, #1A1A1A);
                    border-radius: 20px;
                    padding: 10px 15px;
                    flex: 1;
                    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.2);
                }

                .input-text {
                    flex: 1;
                    color: var(--text, #F0F0F0);
                    font-family: 'Roboto Mono', monospace;
                    font-size: 0.9rem;
                    background: transparent;
                    border: none;
                    outline: none;
                }

                .send-button {
                    width: 24px;
                    height: 24px;
                    background-color: var(--primary, #25D366);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    margin-left: 10px;
                    color: black;
                    cursor: pointer;
                }
                
                .expanded-view {
                    display: flex;
                    width: 100%;
                    align-items: center;
                }
                
                .collapsed-view {
                    cursor: pointer;
                }
                
                .abra-results-container {
                    margin-top: 20px;
                }
                
                .abra-status {
                    margin-bottom: 20px;
                    padding: 10px;
                    background-color: var(--surface, #1A1A1A);
                    border-radius: 4px;
                    color: var(--text, #F0F0F0);
                }
                
                .abra-error {
                    padding: 15px;
                    margin-bottom: 20px;
                    background-color: rgba(244, 67, 54, 0.1);
                    border-left: 5px solid #f44336;
                    border-radius: 4px;
                    color: var(--text, #F0F0F0);
                }
                
                .abra-result {
                    padding: 15px;
                    margin-bottom: 20px;
                    background-color: rgba(76, 175, 80, 0.1);
                    border-left: 5px solid #4CAF50;
                    border-radius: 4px;
                    overflow-x: auto;
                    color: var(--text, #F0F0F0);
                }
                
                .abra-result pre {
                    margin: 0;
                    white-space: pre-wrap;
                }
            `}</style>
        </div>
    );
}