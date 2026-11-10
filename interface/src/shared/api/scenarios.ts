import { api } from "./api";
import type { Scenario, ScenarioSummary } from "@/shared/model";

const RESOURCE_PATH = "/scenarios";

export const ScenariosService = {
  list: async (): Promise<ScenarioSummary[]> => {
    const res = await api.get(RESOURCE_PATH);
    return res.data.data;
  },

  get: async (id: string): Promise<Scenario> => {
    const res = await api.get(`${RESOURCE_PATH}/${id}`);
    return res.data.data;
  },

  save: async (scenario: Scenario): Promise<void> => {
    await api.put(`${RESOURCE_PATH}/${scenario.id}`, scenario);
  },

  importFile: async (
    file: File,
    options: { scenarioId?: string; name?: string; save?: boolean; followLinks?: boolean } = {},
  ): Promise<{ scenario: Scenario; warnings: string[] }> => {
    const form = new FormData();
    form.append("file", file);
    if (options.scenarioId) form.append("scenario_id", options.scenarioId);
    if (options.name) form.append("name", options.name);
    form.append("save", String(options.save ?? false));
    form.append("follow_links", String(options.followLinks ?? false));
    const res = await api.post(`${RESOURCE_PATH}/import`, form, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data.data;
  },
};
