import type { StatuslinePlugin } from "../statusline-types"

export const resourceNamePlugin: StatuslinePlugin = {
  visible: (ctx) => ctx.app.activeResourceView() !== undefined,
  render: (ctx) => (
    <>
      <ctx.Text color="success">•</ctx.Text>
      <ctx.Text> </ctx.Text>
      <ctx.Text>{ctx.app.activeResourceView()?.resourceName()}</ctx.Text>
    </>
  ),
}
