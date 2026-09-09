/**
 * File tree, editor tabs, and open-files panel — shared across FileTree,
 * FileTreeNode, EditorTabs, OpenFilesPanel. Namespace: `files`.
 */
export default {
  en: {
    // FileTree header + toolbar
    heading: 'Files',
    newFile: 'New file',
    newFolder: 'New folder',
    importFiles: 'Import files',
    collapseAll: 'Collapse all',
    refresh: 'Refresh',
    emptyFolder: 'Empty folder',

    // FileTree prompts + status
    newFileTitle: 'New file',
    newFilePrompt: 'Name (e.g. idea.md)',
    newFolderTitle: 'New folder',
    newFolderPrompt: 'Name',
    renameTitle: 'Rename',
    renamePrompt: 'New name',
    create: 'Create',
    rename: 'Rename',
    move: 'Move',
    moveTitle: 'Move',
    moveToLabel: 'Folder',
    indexingN: 'Indexing {i}/{total}…',
    indexing: 'Indexing…',

    // Moving and deleting. Every refusal ends by saying nothing happened —
    // after an alert the first question is always "did some of it go through".
    kbRoot: 'the top of the knowledge base',
    moveToPrompt: 'Where should these go? Leave the field blank for the top of the knowledge base.',
    moveIntoSelf: '“{name}” cannot be moved inside itself. Nothing was moved.',
    moveNoTarget: 'There is no folder called “{dir}”. Nothing was moved.',
    moveExists: '“{name}” already exists in {dir}. Nothing was moved.',
    // The delete dialog. It shows the list rather than describing it, so the
    // wording here only has to frame the list and total it up.
    deleteTitle: 'Delete',
    deleteLead: 'These will be removed from your folder. Untick anything you want to keep.',
    nFiles: '{n} files',
    deleteSummary: '{n} selected. This cannot be undone.',
    deleteSummaryFolders:
      '{n} selected — {dirs} of them folders, holding {files} files. This cannot be undone.',
    deleteConfirmButton: 'Delete {n}',
    moveFailed: '“{name}” could not be moved. Anything moved before it stayed moved.',
    deleteFailed: '“{name}” could not be deleted. Anything deleted before it is gone.',

    // FileTree context menu
    menu: {
      newFile: 'New File',
      newFolder: 'New Folder',
      importFiles: 'Import Files…',
      indexDocs: 'Index docs for AI',
      open: 'Open',
      indexForAi: 'Index for AI',
      selected: '{n} selected',
      addToChat: 'Add to Chat',
      rename: 'Rename…',
      moveTo: 'Move to…',
      delete: 'Delete',
      deleteN: 'Delete {n} items',
      copyPath: 'Copy Path',
      copyPaths: 'Copy Paths',
      copyRelativePath: 'Copy Relative Path',
      copyRelativePaths: 'Copy Relative Paths',
    },

    // Editor tabs context menu
    tabs: {
      close: 'Close',
      closeOthers: 'Close Others',
      closeToRight: 'Close to the Right',
      closeSaved: 'Close Saved',
      closeAll: 'Close All',
    },

    // Open Files panel
    openFiles: 'Open Files ({n})',
    hideTabBar: 'Hide editor tab bar',
    showTabBar: 'Show editor tab bar',
    saveAll: 'Save all',
    closeAll: 'Close all',
  },
  zh: {
    // FileTree header + toolbar
    heading: '文件',
    newFile: '新建文件',
    newFolder: '新建文件夹',
    importFiles: '导入文件',
    collapseAll: '全部折叠',
    refresh: '刷新',
    emptyFolder: '空文件夹',

    // FileTree prompts + status
    newFileTitle: '新建文件',
    newFilePrompt: '名称（例如 idea.md）',
    newFolderTitle: '新建文件夹',
    newFolderPrompt: '名称',
    renameTitle: '重命名',
    renamePrompt: '新名称',
    create: '创建',
    rename: '重命名',
    move: '移动',
    moveTitle: '移动',
    moveToLabel: '文件夹',
    indexingN: '正在索引 {i}/{total}…',
    indexing: '索引中…',

    kbRoot: '知识库根目录',
    moveToPrompt: '这些要移动到哪里？留空表示知识库根目录。',
    moveIntoSelf: '「{name}」不能移动到它自己里面。没有移动任何东西。',
    moveNoTarget: '没有名为「{dir}」的文件夹。没有移动任何东西。',
    moveExists: '{dir} 里已经有「{name}」了。没有移动任何东西。',
    deleteTitle: '删除',
    deleteLead: '这些会从你的文件夹里移除。想留下的，把勾去掉。',
    nFiles: '{n} 个文件',
    deleteSummary: '已选 {n} 项。此操作无法撤销。',
    deleteSummaryFolders: '已选 {n} 项，其中 {dirs} 个是文件夹，装着 {files} 个文件。此操作无法撤销。',
    deleteConfirmButton: '删除 {n} 项',
    moveFailed: '「{name}」没能移动。在它之前移动的仍然移动了。',
    deleteFailed: '「{name}」没能删除。在它之前删掉的已经没了。',

    // FileTree context menu
    menu: {
      newFile: '新建文件',
      newFolder: '新建文件夹',
      importFiles: '导入文件…',
      indexDocs: '为 AI 建立文档索引',
      open: '打开',
      indexForAi: '为 AI 建立索引',
      selected: '已选 {n} 项',
      addToChat: '添加到对话',
      rename: '重命名…',
      moveTo: '移动到…',
      delete: '删除',
      deleteN: '删除 {n} 项',
      copyPath: '复制路径',
      copyPaths: '复制路径',
      copyRelativePath: '复制相对路径',
      copyRelativePaths: '复制相对路径',
    },

    // Editor tabs context menu
    tabs: {
      close: '关闭',
      closeOthers: '关闭其他',
      closeToRight: '关闭右侧',
      closeSaved: '关闭已保存',
      closeAll: '全部关闭',
    },

    // Open Files panel
    openFiles: '打开的文件（{n}）',
    hideTabBar: '隐藏编辑器标签栏',
    showTabBar: '显示编辑器标签栏',
    saveAll: '全部保存',
    closeAll: '全部关闭',
  },
}
