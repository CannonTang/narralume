/* 协作对话获得自己的模型与思考档设置：modelId 为空表示跟随全局 writing
   分配；reasoningEffort 为空表示低档（助手既有默认）。 */
export const migration037 = {
  version: 37,
  name: "assistant-conversation-settings",
  sql: `
    ALTER TABLE assistant_conversations
      ADD COLUMN settings_json TEXT
        CHECK (settings_json IS NULL OR json_valid(settings_json));
  `,
} as const;
