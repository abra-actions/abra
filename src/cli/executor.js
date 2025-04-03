// src/actions/executor.js

import actionRegistry from './actionRegistry';

export async function executeAction(actionName, params) {
  const actionFn = actionRegistry[actionName];

  if (!actionFn) {
    throw new Error(`Action "${actionName}" is not registered.`);
  }

  try {
    const result = await actionFn(params);
    return { success: true, result };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
