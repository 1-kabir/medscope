const fs = require("fs");
let s = fs.readFileSync("functions/checker/src/main.js", "utf8");

// header comment
s = s.replace("   slot + 60 min, still nothing -> Sarvam voice call speaking the alert in Bengali\n", "");
// timing comment line
s = s.replace("   callAfterMinutes  — when the elder's Sarvam voice call goes out\n", "");
// CALL_AFTER const
s = s.replace(/\nconst CALL_AFTER_MINUTES = Number\(process\.env\.ESCALATION_CALL_AFTER_MINUTES \|\| 45\);/, "");
// sarvamCall function
const scStart = s.indexOf("async function sarvamCall(to, spokenText) {");
const scEnd = s.indexOf("}\n\n", scStart) + 3;
if (scStart > 0) s = s.slice(0, scStart) + s.slice(scEnd);
// VA block + greeting + voiceAgentCall (from the comment to the deliver helper)
const vaStart = s.indexOf("// Sarvam Voice Agent: instant outbound call to the ELDER.");
const vaEnd = s.indexOf("// One delivery attempt for one contact and channel");
if (vaStart > 0 && vaEnd > vaStart) s = s.slice(0, vaStart) + s.slice(vaEnd);
// summary counters
s = s.replace('if (result.ok) summary[channel === "whatsapp" ? "whatsapp" : "calls"]++;', "if (result.ok) summary.whatsapp++;");
s = s.replace(', calls: 0, retried', ', retried');
// comments
s = s.replace("no message,\n    // no call.", "no message.");
s = s.replace("      // The elder's own phone number: the voice agent calls THEM, not family.\n", "");
// call leg block in the loop
const legStart = s.indexOf("          // The elder's phone gets the voice-agent call");
const legEnd = s.indexOf("          // Second family warning");
if (legStart > 0 && legEnd > legStart) s = s.slice(0, legStart) + s.slice(legEnd);

fs.writeFileSync("functions/checker/src/main.js", s);
console.log("checker stripped");
