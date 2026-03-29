"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VaultIndex = void 0;
const obsidian_1 = require("obsidian");
const hash_1 = require("../core/hash");
const logger_1 = require("../core/logger");
const inference_1 = require("./inference");
const parser_1 = require("./parser");
class VaultIndex {
    constructor(app, model, settings, onExternalChange) {
        this.app = app;
        this.model = model;
        this.settings = settings;
        this.onExternalChange = onExternalChange;
        this.lastWrittenHash = new Map();
        this.fileSimplexKeys = new Map();
        this.inferenceContexts = new Map();
        this.lastInferredSnapshot = "";
        this.debouncedChange = (0, obsidian_1.debounce)((file) => {
            void this.onFileChange(file);
        }, 100, true);
        this.app.vault.on("modify", (file) => file instanceof obsidian_1.TFile && this.debouncedChange(file));
        this.app.vault.on("create", (file) => file instanceof obsidian_1.TFile && this.debouncedChange(file));
        this.app.vault.on("delete", (file) => this.onFileDelete(file));
        this.app.vault.on("rename", (file, oldPath) => {
            if (file instanceof obsidian_1.TFile)
                this.onFileRename(file, oldPath);
        });
    }
    recordWrite(path, content) {
        this.lastWrittenHash.set(path, (0, hash_1.djb2Hash)(content));
        logger_1.logger.debug("vault-index", "Recorded plugin write hash", {
            path,
            hash: this.lastWrittenHash.get(path)
        });
    }
    updateSettings(settings) {
        this.settings = settings;
        this.rebuildInferredSimplices();
    }
    async fullScan() {
        const files = this.app.vault.getMarkdownFiles();
        logger_1.logger.info("vault-index", "Starting full vault scan", {
            fileCount: files.length
        });
        for (const file of files) {
            const content = await this.app.vault.read(file);
            this.processFile(file, content);
        }
        this.rebuildInferredSimplices();
        logger_1.logger.info("vault-index", "Completed full vault scan", {
            fileCount: files.length,
            indexedNodeCount: this.model.nodes.size,
            simplexCount: this.model.simplices.size
        });
    }
    async onFileChange(file) {
        if (file.extension !== "md")
            return;
        const content = await this.app.vault.read(file);
        const currentHash = (0, hash_1.djb2Hash)(content);
        if (this.lastWrittenHash.get(file.path) === currentHash) {
            logger_1.logger.debug("vault-index", "Suppressed self-triggered modify event", {
                path: file.path,
                hash: currentHash
            });
            return;
        }
        logger_1.logger.info("vault-index", "Processing changed file", {
            path: file.path,
            hash: currentHash
        });
        this.processFile(file, content);
        this.rebuildInferredSimplices();
        this.onExternalChange?.();
    }
    onFileDelete(file) {
        if (!(file instanceof obsidian_1.TFile))
            return;
        logger_1.logger.info("vault-index", "File deleted", { path: file.path });
        this.inferenceContexts.delete(file.path);
        this.model.removeNode(file.path);
        this.model.replaceSourceSimplices(file.path, []);
        this.rebuildInferredSimplices();
        this.onExternalChange?.();
    }
    onFileRename(file, oldPath) {
        logger_1.logger.info("vault-index", "File renamed", {
            oldPath,
            newPath: file.path
        });
        this.model.updateNodeId(oldPath, file.path);
        const oldKeys = this.fileSimplexKeys.get(oldPath);
        if (oldKeys) {
            this.fileSimplexKeys.set(file.path, oldKeys);
            this.fileSimplexKeys.delete(oldPath);
        }
        const context = this.inferenceContexts.get(oldPath);
        if (context) {
            this.inferenceContexts.set(file.path, { ...context, path: file.path });
            this.inferenceContexts.delete(oldPath);
        }
        this.rebuildInferredSimplices();
        this.onExternalChange?.();
    }
    processFile(file, content) {
        this.model.setNode(file.path, { isVirtual: false });
        const parsed = (0, parser_1.parseSimplices)(content, file.path, this.app);
        this.model.replaceSourceSimplices(file.path, parsed.simplices);
        this.fileSimplexKeys.set(file.path, new Set(parsed.simplices.map((simplex) => simplex.nodes.join("|"))));
        this.inferenceContexts.set(file.path, (0, inference_1.buildInferenceContext)(this.app, file, content));
        logger_1.logger.info("vault-index", "Indexed file", {
            path: file.path,
            parsedSimplexCount: parsed.simplices.length,
            parsedNodeCount: parsed.nodeIds.size,
            totalNodeCount: this.model.nodes.size,
            totalSimplexCount: this.model.simplices.size
        });
    }
    rebuildInferredSimplices() {
        const inferred = (0, inference_1.inferSimplices)([...this.inferenceContexts.values()], this.settings);
        this.model.replaceInferredSimplices(inferred);
        const snapshot = JSON.stringify({
            inferredSimplexCount: inferred.length,
            totalSimplexCount: this.model.simplices.size,
            totalNodeCount: this.model.nodes.size,
            enabled: this.settings.enableInferredEdges
        });
        if (snapshot !== this.lastInferredSnapshot) {
            this.lastInferredSnapshot = snapshot;
            logger_1.logger.debug("vault-index", "Updated inferred graph state", JSON.parse(snapshot));
        }
    }
    destroy() {
        // Obsidian handles event cleanup via plugin registration scope.
    }
}
exports.VaultIndex = VaultIndex;
