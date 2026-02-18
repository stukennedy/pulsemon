/**
 * JSX-to-string helper for WebSocket HTML partials.
 * Used by SearchSession DO to render components to strings over WS.
 */

// Hono JSX nodes have a toString() that returns the HTML.
export async function jsxToString(node: any): Promise<string> {
  if (node && typeof node.toString === "function") {
    const result = node.toString();
    if (result instanceof Promise) return await result;
    return result;
  }
  return String(node);
}
