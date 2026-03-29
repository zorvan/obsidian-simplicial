"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.logger = void 0;
function formatDetails(details) {
    if (!details)
        return "";
    try {
        return ` ${JSON.stringify(details)}`;
    }
    catch {
        return " [unserializable-details]";
    }
}
function write(level, scope, message, details) {
    const prefix = `[Simplicial:${scope}] ${message}${formatDetails(details)}`;
    if (level === "error") {
        console.error(prefix);
        return;
    }
    if (level === "warn") {
        console.warn(prefix);
        return;
    }
    if (level === "debug") {
        console.debug(prefix);
        return;
    }
    console.log(prefix);
}
exports.logger = {
    debug(scope, message, details) {
        write("debug", scope, message, details);
    },
    info(scope, message, details) {
        write("info", scope, message, details);
    },
    warn(scope, message, details) {
        write("warn", scope, message, details);
    },
    error(scope, message, details) {
        write("error", scope, message, details);
    }
};
