# abra - AI-Powered Function Discovery and Execution

<div style="text-align: center;">
    <img src="./logo.png" alt="abra logo" width="150" style="margin: 20px auto;">
</div>

## 🚀 Overview

**abra** is a TypeScript SDK that enables natural language interaction with your application's functions. By adding a simple `@abra-action` annotation to your TypeScript functions, users can interact with your application through natural language requests.

## ✨ Features

- **TypeScript Integration**: Automatically extracts type information from your annotated functions
- **LLM-powered**: Uses OpenAI's GPT models to understand natural language requests
- **Zero Boilerplate**: Just add an annotation to expose functions to abra
- **Type Safety**: Validates and transforms user inputs according to your type definitions
- **Plug-and-Play**: Easy to integrate with existing TypeScript projects

## 🛠️ Installation

```bash
npm install abra-actions
```

## 🔗 Quick Start

### 1. Annotate your functions

```typescript
/**
 * @abra-action Add products to the user's shopping cart
 */
export function addToCart(params: {
  productId: string;
  quantity: number;
  size?: "small" | "medium" | "large";
  color?: string;
}): Promise<{success: boolean; cartItems: number}> {
  // Your implementation here
  return Promise.resolve({success: true, cartItems: 5});
}
```

### 2. Generate action definitions

```bash
npx abra-actions
```

This will scan your project for `@abra-action` annotations and generate an `actions.json` file.

### 3. Add the abra prompt to your UI

```jsx
import { AbraActionPrompt } from '@abra/sdk';

function MyComponent() {
  return (
    <div>
      <h1>My App</h1>
      <AbraActionPrompt />
    </div>
  );
}
```

## 📝 API Reference

### @abra-action annotation

Add this JSDoc annotation to any TypeScript function you want to expose to abra:

```typescript
/**
 * @abra-action Description of what this function does
 */
```

### AbraActionPrompt Component

A React component that provides a chat-like interface for users to interact with your functions.

```jsx
<AbraActionPrompt />
```

### executeAction(actionName, params)

Directly execute an action with the given parameters:

```javascript
import { executeAction } from '@abra/sdk';

const result = await executeAction('addToCart', {
  productId: '12345',
  quantity: 2,
  size: 'medium'
});
```

## 🔧 Configuration

Create an `abra.config.js` file in your project root:

```javascript
module.exports = {
  // OpenAI API key (alternatively use OPENAI_API_KEY env variable)
  apiKey: 'your-openai-api-key',
  
  // Directories to scan for @abra-action annotations
  include: ['src/**/*.ts'],
  
  // Directories to exclude
  exclude: ['node_modules', 'dist'],
  
  // Custom LLM configuration
  llm: {
    model: 'gpt-4', // or 'gpt-3.5-turbo'
    temperature: 0.1,
    max_tokens: 500
  }
};
```

## 📄 License

MIT

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.