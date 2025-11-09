declare module "@babel/core" {
    export function transformAsync(code: string, options?: any): Promise<any>;
    const babel: {
        transformAsync: typeof transformAsync;
        [key: string]: any;
    };
    export default babel;
}
