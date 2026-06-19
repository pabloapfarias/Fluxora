import type { AiModelInfo, AiProviderConfig } from "@fluxora/shared";

export interface ProviderCatalogEntry {
  id: string;
  providerId: string;
  modelName: string;
  displayName?: string;
}

export interface ProviderCatalogResult {
  providers: { id: string; displayName: string }[];
  models: ProviderCatalogEntry[];
  modelsByProvider: Record<string, ProviderCatalogEntry[]>;
  fetchedAt: string;
}

function toCatalogProvider(provider: AiProviderConfig) {
  return { id: provider.id, displayName: provider.name };
}

function toCatalogModel(providerId: string, model: AiModelInfo): ProviderCatalogEntry {
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
): ProviderCatalogResult {
  const catalogProviders = providers.map(toCatalogProvider);
  const catalogModelsByProvider: Record<string, ProviderCatalogEntry[]> = {};
  const catalogModels: ProviderCatalogEntry[] = [];

  providers.forEach((provider) => {
    const directModels = modelsByProvider[provider.id] || [];
    const withDefault = [...directModels];

    if (
      provider.defaultModel &&
      !withDefault.some(
        (model) =>
          model.id === provider.defaultModel || model.name === provider.defaultModel
      )
    ) {
      withDefault.push({
        id: provider.defaultModel,
        providerId: provider.id,
        name: provider.defaultModel,
      } as AiModelInfo);
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

export async function loadProviderCatalog(
  providers: AiProviderConfig[]
): Promise<ProviderCatalogResult> {
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
