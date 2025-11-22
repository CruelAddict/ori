## IMPORTANT

- Try to keep things in one function unless composable or reusable
- DO NOT do unnecessary destructuring of variables
- DO NOT use `else` statements unless necessary
- DO NOT use `try`/`catch` if it can be avoided
- AVOID `try`/`catch` where possible
- AVOID `else` statements
- AVOID using `any` type
- AVOID `let` statements
- PREFER single word variable names where possible
- Use as many bun apis as possible like Bun.file()
- This repository uses feature sliced design, your implementation should follow its principles
- Separate UI from viewmodel-like logic. Keybindings in use are considered UI logic, the functions we map keys to should be exported from the file that owns component's logic
