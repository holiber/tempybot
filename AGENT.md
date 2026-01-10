# DO NOT DO ANY COMPASION OR ASSERTS DIRECTLY WITH STDOUT AND STDERR

this doesnt work stable now in this repo
DONOT:

    const details = (r.stderr ?? "").trim() || (r.stdout ?? "").trim() || `exit=${r.status ?? "unknown"}`;
    throw new Error(`gh ${args.join(" ")} failed: ${details}`);
    
Use json output, convert to json or write to file before comparsion
