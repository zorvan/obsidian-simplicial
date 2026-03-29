"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.djb2Hash = djb2Hash;
exports.hashLabel = hashLabel;
function djb2Hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) + h) ^ str.charCodeAt(i);
        h = h >>> 0;
    }
    return h;
}
function hashLabel(label) {
    const palette = ["purple", "teal", "coral", "pink", "blue", "amber"];
    if (!label)
        return "purple";
    return palette[djb2Hash(label) % palette.length];
}
