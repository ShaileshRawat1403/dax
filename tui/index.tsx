#!/usr/bin/env node
/** @jsxImportSource react */

import { render } from "ink"
import React from "react"
import App from "./components/App.jsx"

const { waitUntilExit } = render(React.createElement(App))

waitUntilExit().then(() => {
  process.exit(0)
})
