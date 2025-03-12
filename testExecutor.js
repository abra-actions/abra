import { executeAction } from "./src/core/executor.js";

(async () => {
    const result = await executeAction("createUser", { 
        user: { name: "Jake", email: "jake@example.com", age: 30 } 
    });
    console.log("Execution Result:", result);
})();
