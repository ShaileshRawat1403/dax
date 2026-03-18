export function isRefineSubmitKey(input: {
  name: string
  shift?: boolean
  meta?: boolean
  ctrl?: boolean
  super?: boolean
}) {
  return (
    input.name === "return" &&
    !input.shift &&
    !input.meta &&
    !input.ctrl &&
    !input.super
  )
}
