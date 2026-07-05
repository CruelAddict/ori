import type { StatuslinePlugin } from "../statusline-types"

export const commandsHintPlugin: StatuslinePlugin = {
  render: (ctx) => (
    <>
      <ctx.Text>ctrl+p</ctx.Text>
      <ctx.Text> </ctx.Text>
      <ctx.Text color="text_muted">commands</ctx.Text>
    </>
  ),
}
