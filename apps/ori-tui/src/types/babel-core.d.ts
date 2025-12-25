declare module "@babel/core" {
  export function transformAsync(code: string, options?: unknown): Promise<unknown>;
  const babel: {
    transformAsync: typeof transformAsync;
    [key: string]: unknown;
  };
  export default babel;
}
