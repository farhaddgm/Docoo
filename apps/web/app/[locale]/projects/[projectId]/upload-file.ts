import { ACCEPTED_EXTENSIONS, uploadSourceFile } from '../../knowledge/source-upload';
import type { Attachment } from './problem-types';

export { ACCEPTED_EXTENSIONS };

/** Sends a file as a source of the project, as an attachment to an answer (ING-001). */
export async function uploadProjectFile(
  workspaceBase: string,
  projectId: string,
  file: File,
): Promise<Attachment> {
  const uploaded = await uploadSourceFile(
    workspaceBase,
    file,
    { kind: 'new', title: file.name, scope: { type: 'project', id: projectId } },
    'ANALYSIS_UPLOAD_FAILED',
  );
  return { sourceId: uploaded.sourceId, versionId: uploaded.versionId, title: file.name };
}
