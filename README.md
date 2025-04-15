# abra – AI-Powered Function Discovery and Execution

## 🚀 Overview

**abra** is a TypeScript SDK that enables natural language interaction with your application's functions. Import the functions you'd like to expose into the action registry and run a single command to enable execution via natural language commands — all on your own infrastructure.

---

## ✨ Features

- **TypeScript Integration** – Automatically extracts type information from your functions
- **LLM-Powered** – Uses OpenAI's GPT models to understand user intent
- **Zero Boilerplate** – Just import functions into the registry, no annotations or decorators
- **Type Safety** – Validates and transforms user input based on your type definitions
- **No Data Leakage** – Only function names and descriptions are sent to the LLM; your code and data stay private
- **Executes Locally** – All actions are run through your code, on your infra, with your auth and security context

---

## 🛠️ Installation

```bash
npm install abra-actions
```

---

## 🔗 Quick Start

### 1. Initialize abra

```bash
npx abra-actions init
```

This command sets up the abra scaffold in your `/src` directory:

- `actionRegistry.ts` – Import and register your callable functions here
- `actions.json` – Generated manifest of all actions and types
- `abra-executor.ts` – Lightweight wrapper to execute actions via the registry

---

### 2. Register your functions

```ts
// src/abra-actions/__generated__/actionRegistry.ts

import { 
  addToCart, 
  searchProducts, 
  filterProducts, 
  sortProducts 
} from './handlers';

export const actionRegistry = {
  addToCart,
  searchProducts,
  filterProducts,
  sortProducts
};
```

---

### 3. Generate the actions

```bash
npx abra-actions generate
```

This command:
- Populates `actions.json` with metadata about your functions
- Infers parameter types
- Updates the `abra-executor.ts` file for secure local execution

---

### 4. Use the assistant in your UI

```tsx
import { AbraAssistant } from '../abra-actions/AbraAssistant';

function MyComponent() {
  return (
    <div>
      <h1>My App</h1>
      <AbraAssistant />
    </div>
  );
}
```

---

### 🧩 Using Abra via API (Custom Components)

If you prefer to connect your own UI to Abra’s backend without using the built-in assistant, you can call the API directly and pass the result to `executeAction`.

The API requires an environment variable:

```bash
REACT_APP_ABRA_API_KEY=your-key-here
```

---

### ⚡ Minimal Example

```tsx
import { useState } from 'react';
import { executeAction } from '../abra-actions/__generated__/abra-executor';
import actions from '../abra-actions/__generated__/actions.json';

const BACKEND_URL = 'abra-api';

export default function AbraInput() {
  const [input, setInput] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();

    const res = await fetch(`${BACKEND_URL}/api/resolve-action`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ABRA_PUBLIC_API_KEY,
      },
      body: JSON.stringify({ userIntent: input, actions }),
    });

    const { action, params } = await res.json();
    await executeAction(action, params);
  };

  return (
    <form onSubmit={handleSubmit}>
      <input value={input} onChange={e => setInput(e.target.value)} />
      <button type="submit">Run</button>
    </form>
  );
}
```

This gives you full control over the UI while still leveraging Abra’s core LLM routing and function execution.

---

## 📄 License

MIT

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a pull request.
