import blessed from "blessed";

export function createHeader(screen: any) {
  const header = blessed.box({
    top: 0,
    left: 0,
    width: "100%",
    height: 2,
    style: {
      fg: "cyan",
      bold: true,
    },
    content: " DAX - Deterministic AI Execution ",
  });

  screen.append(header);

  function setStatus(status: string) {
    header.setContent(` DAX | ${status} `);
    screen.render();
  }

  return { header, setStatus };
}
