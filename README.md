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

## 📄 License

MIT

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a pull request.
