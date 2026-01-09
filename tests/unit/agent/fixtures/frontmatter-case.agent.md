---
VeRsIoN: 9.9.9
ICON: 🧪
TiTlE: From YAML
DeScRiPtIoN: YAML description.
StAtUs: Deprecated
TemplateEngine: ""
InPuT: hello
ReCoMmEnDeD:
  Models: ["gpt-4o"]
  Capabilities: ["fs"]
ReQuIrEd:
  EnV: ["API_KEY"]
  StArTuP: init
CoMmAnDs:
  - ./commands
  - name: test
    description: Test command
    body: |
      echo hi
---

# From YAML
YAML description.

## System
System from section.

## Tools
return {
  init: {
    fn: () => true,
    scheme: {
      name: "init",
      description: "Init",
      parameters: { type: "object", properties: {} },
    },
  },
};

