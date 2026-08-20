/* 建项目不再自动创建空的「正文总稿」：它没有任何功能入口，只让交付页
   常驻「仍是空稿」警告。清理存量中从未写入过任何版本的 manuscript 文档；
   导入或手动创建过内容的 manuscript（有版本历史）保留。 */
export const migration036 = {
  version: 36,
  name: "drop-empty-manuscript-documents",
  sql: `
    DELETE FROM documents
     WHERE kind = 'manuscript'
       AND id NOT IN (SELECT document_id FROM document_versions);
  `,
} as const;
