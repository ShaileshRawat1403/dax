import blessed from "blessed";

export function createPermissionDialog(
  screen: any,
  onApprove: (always: boolean) => void,
  onDeny: () => void
) {
  const dialog = blessed.box({
    top: "center",
    left: "center",
    width: 60,
    height: 12,
    border: {
      type: "line",
      fg: "yellow",
    } as any,
    style: {
      fg: "white",
      bg: "black",
      border: {
        fg: "yellow",
      },
    },
    hidden: true,
  });

  const content = blessed.box({
    width: "100%",
    height: "100%",
    content: "",
  });

  dialog.append(content);
  screen.append(dialog);

  function show(permission: string, pattern: string, reason: string) {
    content.setContent(
      `{bold}Permission Request{/bold}\n\n` +
      `Tool: ${permission}\n` +
      `Pattern: ${pattern}\n` +
      `Reason: ${reason}\n\n` +
      `[a] Approve Once  [A] Always Allow  [d] Deny`
    );
    dialog.show();
    screen.render();
  }

  function hide() {
    dialog.hide();
    screen.render();
  }

  return { dialog, show, hide };
}
