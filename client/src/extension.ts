import { TextEncoder } from "util";
import * as vscode from "vscode";
import { PluginConfig, TsLanguageFeaturesApiV0, TsLanguageFeatures } from "../../types";

const pluginConfig: PluginConfig = {
  enabled: false,
};
let tsApi: TsLanguageFeaturesApiV0;

export async function activate(context: vscode.ExtensionContext) {
  let api = await getTsApi();
  if (!api) {
    return vscode.window.showErrorMessage(
      "Chattriggers unable to start. Make sure that typescript language features is enabled.",
    );
  }
  tsApi = api;

  vscode.workspace.onDidChangeConfiguration(
    handleConfigurationChanged,
    null,
    context.subscriptions,
  );

  vscode.window.onDidChangeActiveTextEditor(handleChangeTextEditor, null, context.subscriptions);
  context.subscriptions.push(
    vscode.commands.registerCommand("chattriggers.initialize", handleInitializeCommand),
  );

  const enabled = vscode.workspace.getConfiguration("chattriggers").get<boolean>("enabled")!;

  if (enabled) {
    enablePlugin();
  }
  await handleChangeTextEditor();
}

async function handleInitializeCommand() {
  const name = await vscode.window.showInputBox({
    prompt: "Name to initialize CT module with",
    ignoreFocusOut: true,
    placeHolder: "Module name",
    validateInput(value) {
      if (!value || value.trim() !== value) {
        return "Must enter a valid name";
      }
    },
  });
  if (!name) {
    return;
  }

  const selectedLanguage = await vscode.window.showQuickPick(["Javascript", "Typescript"], {
    ignoreFocusOut: true,
    placeHolder: "Module language template",
  });
  if (!selectedLanguage) return;

  let configCreator = vscode.workspace
    .getConfiguration("chattriggers")
    .get<string>("defaultCreator");

  let creator;
  if (configCreator === "" || configCreator === undefined) {
    creator = await vscode.window.showInputBox({
      ignoreFocusOut: true,
      prompt: "Creator",
      validateInput(value) {
        if (!value || value.trim() !== value) {
          return "Must enter a valid name";
        }
      },
    });
  } else {
    creator = configCreator;
  }
  if (!creator) return;

  enablePlugin();

  // If automatic detection of workspaces isn't enabled and global enabled isn't set,
  // then set workspace enabled to true.
  const configuration = vscode.workspace.getConfiguration("chattriggers");
  if (!configuration.get<boolean>("detectWorkspaces") && !configuration.get<boolean>("enabled")) {
    await configuration.update("enabled", true);
  }

  if (selectedLanguage === "Typescript") {
    await bootstrapTypescript(name, creator);
  } else {
    await bootstrapJavascript(name, creator);
  }
  await handleChangeTextEditor();
}

async function bootstrapTypescript(moduleName: string, creatorName: string) {
  const workspace = new vscode.WorkspaceEdit();
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;

  const tsconfigPath = vscode.Uri.file(workspacePath + "/tsconfig.json");
  const indexPath = vscode.Uri.file(workspacePath + "/src/index.ts");
  const metadataPath = vscode.Uri.file(workspacePath + "/metadata.json");

  const tsconfigContent = `\
{
  "compilerOptions": {
    "target": "es6",
    "module": "commonjs",
    "lib": ["es2016"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "noImplicitAny": false,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
`;

  const metadataContent = `\
{
  "name": "${moduleName}",
  "creator": "${creatorName}",
  "entry": "dist/index.js",
  "version": "0.0.1"
}
`;

  try {
    const createFileConfig = {
      ignoreIfExists: true,
      overwrite: false,
    };
    workspace.createFile(tsconfigPath, createFileConfig);
    workspace.createFile(indexPath, createFileConfig);
    workspace.createFile(metadataPath, createFileConfig);
    await vscode.workspace.applyEdit(workspace);

    await Promise.all([
      vscode.workspace.fs.writeFile(tsconfigPath, new TextEncoder().encode(tsconfigContent)),
      vscode.workspace.fs.writeFile(metadataPath, new TextEncoder().encode(metadataContent)),
    ]);
  } catch (e) {
    vscode.window.showErrorMessage("Unable to initialize module.");
    return;
  }
}

async function bootstrapJavascript(moduleName: string, creatorName: string) {
  const workspace = new vscode.WorkspaceEdit();
  const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;

  const indexPath = vscode.Uri.file(workspacePath + "/index.js");
  const metadataPath = vscode.Uri.file(workspacePath + "/metadata.json");

  const metadataContent = `\
{
  "name": "${moduleName}",
  "creator": "${creatorName}",
  "entry": "index.js",
  "version": "0.0.1"
}
`;

  try {
    const createFileConfig = {
      ignoreIfExists: true,
      overwrite: false,
    };
    workspace.createFile(indexPath, createFileConfig);
    workspace.createFile(metadataPath, createFileConfig);
    await vscode.workspace.applyEdit(workspace);

    await Promise.all([
      vscode.workspace.fs.writeFile(metadataPath, new TextEncoder().encode(metadataContent)),
    ]);
  } catch (e) {
    vscode.window.showErrorMessage("Unable to initialize module.");
    return;
  }
}

async function handleConfigurationChanged(event: vscode.ConfigurationChangeEvent) {
  if (event.affectsConfiguration("chattriggers.enabled")) {
    const enabled = vscode.workspace.getConfiguration("chattriggers").get<boolean>("enabled")!;

    enabled ? enablePlugin() : disablePlugin();
  }

  if (event.affectsConfiguration("chattriggers.detectWorkspaces")) {
    await handleChangeTextEditor();
  }
}

async function handleChangeTextEditor() {
  const configuration = vscode.workspace.getConfiguration("chattriggers");
  const detectWorkspaces = configuration.get<boolean>("detectWorkspaces");
  const enabledSetting = configuration.get<boolean>("enabled");

  if (enabledSetting) {
    enablePlugin();
    return;
  }

  if (detectWorkspaces) {
    const metadataFile = (await vscode.workspace.findFiles("metadata.json"))[0];
    if (metadataFile != null) {
      enablePlugin();
      return;
    }
  }

  disablePlugin();
}

export function deactivate() {}

async function getTsApi() {
  const extension = vscode.extensions.getExtension<TsLanguageFeatures>(
    "vscode.typescript-language-features",
  );
  if (!extension) {
    vscode.window.showErrorMessage("Error while setting up typescript language server");
    return;
  }

  await extension.activate();
  if (!extension.exports || !extension.exports.getAPI) {
    vscode.window.showErrorMessage("Error while setting up typescript language server");
    return;
  }
  const api = extension.exports.getAPI(0);
  return api;
}

function refreshPluginConfig() {
  tsApi.configurePlugin("tsserver-plugin", pluginConfig);
}

function enablePlugin() {
  if (!pluginConfig.enabled) {
    showEnableNotification();
  }
  pluginConfig.enabled = true;
  refreshPluginConfig();
}

function disablePlugin() {
  pluginConfig.enabled = false;
  refreshPluginConfig();
}

function showEnableNotification() {
  const progressOptions = {
    location: vscode.ProgressLocation.Notification,
    title: "Enabling Chattriggers...",
    cancellable: false,
  };
  vscode.window.withProgress(progressOptions, async () => {
    await new Promise<void>(resolve => {
      setTimeout(resolve, 2000);
    });
  });
}
