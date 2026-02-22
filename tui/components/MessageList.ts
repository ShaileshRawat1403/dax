import blessed from "blessed";
import { Message } from "../state";

export function createMessageList(screen: any) {
  const box = blessed.box({
    top: 2,
    left: 0,
    width: "100%",
    height: "80%",
    scrollable: true,
    alwaysScroll: true,
    style: {
      fg: "white",
    },
  });

  screen.append(box);

  function render(messages: Message[]) {
    let content = "";
    for (const msg of messages) {
      if (msg.role === "user") {
        content += `{bold}{cyan}User:{/cyan}{/bold} ${msg.content}\n\n`;
      } else if (msg.role === "assistant") {
        content += `{bold}{green}DAX:{/green}{/bold} ${msg.content}\n\n`;
      } else if (msg.role === "tool") {
        content += `{bold}{yellow}Tool (${msg.toolName}):{/yellow}{/bold}\n${msg.toolResult || msg.content}\n\n`;
      }
    }
    box.setContent(content || "{italic}No messages yet. Type a prompt to start.{/italic}");
    screen.render();
  }

  return { box, render };
}
