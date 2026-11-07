import { Masonry } from '../src/index.js'

globalThis.Masonry = Masonry
globalThis.policyViolations = []
document.addEventListener('securitypolicyviolation', event => {
  globalThis.policyViolations.push(event.violatedDirective)
})
