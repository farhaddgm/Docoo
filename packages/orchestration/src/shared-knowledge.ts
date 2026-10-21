/**
 * SQL predicate for knowledge another project shares into this one (ADR-0034). It is true when
 * `item` is project-scope knowledge of a different, live project that
 *  - is linked to a topic this project is also linked to, and
 *  - on that link shares everything (`all`) or lists this item (`selected`).
 * Knowledge stays private to its project (`none`, the default) unless an administrator says
 * otherwise. `roleCondition` is a SQL condition on the scope row `s`, e.g. `s.role is null`.
 */
export function sharedProjectKnowledgeSql(
  item: string,
  projectParam: string,
  roleCondition: string,
): string {
  return `exists (
      select 1 from knowledge_scopes s
        join projects own_project on own_project.id = s.scope_id and own_project.deleted_at is null
        join project_topics own on own.project_id = own_project.id
        join topics shared_topic on shared_topic.id = own.topic_id and shared_topic.deleted_at is null
        join project_topics mine on mine.topic_id = own.topic_id and mine.project_id = ${projectParam}
       where s.item_id = ${item}.id and s.scope_type = 'project' and s.scope_id <> ${projectParam}
         and ${roleCondition}
         and (own.knowledge_sharing = 'all'
              or (own.knowledge_sharing = 'selected'
                  and exists (select 1 from project_shared_knowledge k
                               where k.project_id = own_project.id and k.item_id = ${item}.id))))`;
}
