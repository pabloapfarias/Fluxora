import type {
  AiModelInfo,
  AiProviderConfig,
  OpenCodeCatalogResult,
  OpenCodeModel,
  OpenCodeProvider,
} from "@fluxora/shared";

function toCatalogProvider(provider: AiProviderConfig): OpenCodeProvider {
  return {
    id: provider.id,
    displayName: provider.name,
    authType: provider.apiKeyEnv ? "api" : "none",
  };
}

function toCatalogModel(providerId: string, model: AiModelInfo): OpenCodeModel {
  return {
    id: model.id || model.name,
    providerId,
    modelName: model.name,
    displayName: model.displayName,
  };
}

export function buildProviderCatalog(
  providers: AiProviderConfig[],
  modelsByProvider: Record<string, AiModelInfo[]>
): OpenCodeCatalogResult {
  const catalogProviders = providers.map(toCatalogProvider);
  const catalogModelsByProvider: Record<string, OpenCodeModel[]> = {};
  const catalogModels: OpenCodeModel[] = [];

  providers.forEach((provider) => {
    const directModels = modelsByProvider[provider.id] || [];
    const withDefault = [...directModels];

    if (provider.defaultModel && !withDefault.some((model) => model.id === provider.defaultModel || model.name === provider.defaultModel)) {
      withDefault.push({
        id: provider.defaultModel,
        providerId: provider.id,
        name: provider.defaultModel,
      });
    }

    const mapped = withDefault.map((model) => toCatalogModel(provider.id, model));
    catalogModelsByProvider[provider.id] = mapped;
    catalogModels.push(...mapped);
  });

  return {
    providers: catalogProviders,
    models: catalogModels,
    modelsByProvider: catalogModelsByProvider,
    fetchedAt: new Date().toISOString(),
  };
}

export async function loadProviderCatalog(providers: AiProviderConfig[]): Promise<OpenCodeCatalogResult> {
  const settled = await Promise.all(
    providers.map(async (provider) => {
      try {
        const models = await window.fluxora.providers.listModels(provider.id);
        return [provider.id, models] as const;
      } catch {
        return [provider.id, [] as AiModelInfo[]] as const;
      }
    })
  );

  return buildProviderCatalog(providers, Object.fromEntries(settled));
}
