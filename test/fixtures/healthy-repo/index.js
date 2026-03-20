// Main entry point
function main() {
  console.log("Hello from healthy-repo!")
}

if (require.main === module) {
  main()
}

module.exports = { main }
