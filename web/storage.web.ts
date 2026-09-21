// Browser-mode stand-in for utils/storage.ts, wired in by vite.web.config.ts.
// The desktop build keeps projects in SQLite and the app data folder through
// Tauri. Here everything lives in memory for the lifetime of the page, which
// is enough to run the takeoff tools in an ordinary browser.
import JSZip from 'jszip';
import { PlanSet, ProjectData, TakeoffItem, ItemTemplate } from '../types';

export interface ProjectState {
  items: TakeoffItem[];
  projectData: ProjectData;
  planSets: PlanSet[];
  totalPages: number;
  projectName: string;
}

type PlanSetMeta = Pick<PlanSet, 'id' | 'name' | 'pageCount' | 'startPageIndex' | 'pages'>;

interface StoredProject {
  items: TakeoffItem[];
  projectData: ProjectData;
  planSetsMeta: PlanSetMeta[];
  totalPages: number;
  projectName: string;
  updatedAt: number;
  version: number;
}

let currentProjectJson: string | null = null;
const planFiles = new Map<string, { name: string; data: ArrayBuffer }>();
const templates = new Map<string, ItemTemplate>();

const toMeta = (p: PlanSet): PlanSetMeta => ({
  id: p.id,
  name: p.name,
  pageCount: p.pageCount,
  startPageIndex: p.startPageIndex,
  pages: p.pages,
});

export const saveProjectData = async (
  items: TakeoffItem[],
  projectData: ProjectData,
  planSets: PlanSet[],
  totalPages: number,
  projectName: string = 'Untitled Project'
) => {
  const data: StoredProject = {
    items,
    projectData,
    planSetsMeta: planSets.map(toMeta),
    totalPages,
    projectName,
    updatedAt: Date.now(),
    version: 2,
  };
  currentProjectJson = JSON.stringify(data);
};

export const savePlanFile = async (id: string, file: File) => {
  planFiles.set(id, { name: file.name, data: await file.arrayBuffer() });
};

export const clearProjectData = async () => {
  currentProjectJson = null;
  planFiles.clear();
};

export const loadProjectFromStorage = async (): Promise<ProjectState | null> => {
  if (!currentProjectJson) return null;
  try {
    const data = JSON.parse(currentProjectJson) as StoredProject;
    const planSets: PlanSet[] = [];
    for (const meta of data.planSetsMeta ?? []) {
      const stored = planFiles.get(meta.id);
      if (!stored) {
        console.error(`File data missing for plan ${meta.id}`);
        continue;
      }
      const file = new File([stored.data], stored.name, { type: 'application/pdf' });
      planSets.push({ ...meta, file });
    }
    return {
      items: data.items ?? [],
      projectData: data.projectData ?? {},
      totalPages: data.totalPages ?? 0,
      planSets,
      projectName: data.projectName || 'Untitled Project',
    };
  } catch (error) {
    console.error('Failed to parse project data:', error);
    return null;
  }
};

export const saveFileHandle = async (_handle: unknown): Promise<void> => {
  return;
};

export const getFileHandle = async (): Promise<unknown | null> => {
  return null;
};

export const exportProjectToZip = async (
  items: TakeoffItem[],
  projectData: ProjectData,
  planSets: PlanSet[],
  totalPages: number,
  projectName: string = 'Untitled Project'
): Promise<Blob> => {
  const zip = new JSZip();
  const planSetsMeta = planSets.map(p => ({
    ...toMeta(p),
    fileName: `${p.id}.pdf`,
  }));
  const projectState = {
    version: 2,
    appVersion: '1.1.0',
    items,
    projectData,
    planSetsMeta,
    totalPages,
    projectName,
    exportedAt: new Date().toISOString(),
  };
  zip.file('project.json', JSON.stringify(projectState, null, 2));
  const assets = zip.folder('assets');
  if (assets) {
    for (const plan of planSets) {
      assets.file(`${plan.id}.pdf`, plan.file);
    }
  }
  return await zip.generateAsync({ type: 'blob' });
};

export const importProjectFromZip = async (zipData: File | Uint8Array): Promise<ProjectState> => {
  const zip = await JSZip.loadAsync(zipData);
  const jsonFile = zip.file('project.json');
  if (!jsonFile) throw new Error('Invalid project file: missing project.json');
  const data = JSON.parse(await jsonFile.async('string'));
  const reconstructedPlanSets: PlanSet[] = [];
  const assets = zip.folder('assets');
  if (data.planSetsMeta && assets) {
    for (const pMeta of data.planSetsMeta) {
      const pdfFile = assets.file(pMeta.fileName || `${pMeta.id}.pdf`);
      if (pdfFile) {
        const arrayBuffer = await pdfFile.async('arraybuffer');
        const blob = new Blob([arrayBuffer], { type: 'application/pdf' });
        const file = new File([blob], (pMeta.name || 'plan') + '.pdf', {
          type: 'application/pdf',
          lastModified: Date.now(),
        });
        reconstructedPlanSets.push({
          id: pMeta.id,
          name: pMeta.name,
          pageCount: pMeta.pageCount,
          startPageIndex: pMeta.startPageIndex,
          file,
          pages: pMeta.pages,
        });
      }
    }
  }
  return {
    items: data.items || [],
    projectData: data.projectData || {},
    totalPages: data.totalPages || 0,
    planSets: reconstructedPlanSets,
    projectName: data.projectName || 'Untitled Project',
  };
};

const cloneTemplate = (t: ItemTemplate): ItemTemplate => JSON.parse(JSON.stringify(t));

export const saveTemplate = async (template: ItemTemplate) => {
  templates.set(template.id, cloneTemplate(template));
};

export const getTemplates = async (): Promise<ItemTemplate[]> => {
  return Array.from(templates.values()).map(cloneTemplate);
};

export const deleteTemplate = async (id: string) => {
  templates.delete(id);
};

export const exportTemplatesToJSON = async (list: ItemTemplate[]) => {
  return new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
};

export const importTemplatesFromJSON = async (file: File) => {
  const parsed = JSON.parse(await file.text()) as ItemTemplate[];
  if (!Array.isArray(parsed)) throw new Error('Invalid template file');
  for (const t of parsed) {
    const id = t.id || crypto.randomUUID();
    templates.set(id, cloneTemplate({ ...t, id }));
  }
};

// Read-only view of the in-memory project for scripts and tests driving the
// web build (for example a headless browser checking computed quantities).
const debugState = {
  get project(): StoredProject | null {
    return currentProjectJson ? (JSON.parse(currentProjectJson) as StoredProject) : null;
  },
};
(globalThis as unknown as { __protakeoffWebState?: typeof debugState }).__protakeoffWebState = debugState;
