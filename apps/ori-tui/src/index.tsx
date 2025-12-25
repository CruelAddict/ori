import { main } from "@cli/main";

export { main };

if (import.meta.main) {
  void main();
}
