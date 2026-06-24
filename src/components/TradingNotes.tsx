"use client";

// ============================================================
// TradingNotes.tsx — 交易笔记（TipTap 富文本编辑器）
// ============================================================

import { useState, useEffect, useCallback } from "react";
import { Button, Input, Flex, Empty, Space, Modal, Tooltip } from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  SaveOutlined,
  FileTextOutlined,
  ClockCircleOutlined,
} from "@ant-design/icons";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";

// ── 类型 ────────────────────────────────────────────────────
interface TradingNote {
  id: string;
  title: string;
  content: string; // HTML
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = "ts-stock-monitor:trading-notes";

// ── 工具栏按钮 ──────────────────────────────────────────────
function Toolbar({ editor }: { editor: NonNullable<ReturnType<typeof useEditor>> }) {
  const btnStyle = (active: boolean): React.CSSProperties => ({
    width: 30,
    height: 28,
    border: "none",
    borderRadius: 4,
    background: active ? "var(--accent-bg, #e6f4ff)" : "transparent",
    color: active ? "var(--accent-color, #1677ff)" : "var(--text-secondary, #666)",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: active ? 700 : 400,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.15s",
  });

  return (
    <Flex
      wrap="wrap"
      gap={2}
      align="center"
      style={{
        padding: "6px 10px",
        borderBottom: "1px solid var(--border-color, #f0f0f0)",
        background: "var(--bg-secondary, #fafafa)",
        borderRadius: "8px 8px 0 0",
      }}
    >
      <Tooltip title="加粗"><button style={btnStyle(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()}><b>B</b></button></Tooltip>
      <Tooltip title="斜体"><button style={btnStyle(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()}><i>I</i></button></Tooltip>
      <Tooltip title="下划线"><button style={btnStyle(editor.isActive("underline"))} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></button></Tooltip>
      <Tooltip title="删除线"><button style={btnStyle(editor.isActive("strike"))} onClick={() => editor.chain().focus().toggleStrike().run()}><s>S</s></button></Tooltip>

      <div style={{ width: 1, height: 18, background: "var(--border-color, #e8e8e8)", margin: "0 4px" }} />

      <Tooltip title="标题1"><button style={{...btnStyle(editor.isActive("heading", { level: 1 })), fontSize: 15, fontWeight: 700}} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</button></Tooltip>
      <Tooltip title="标题2"><button style={{...btnStyle(editor.isActive("heading", { level: 2 })), fontSize: 14, fontWeight: 600}} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button></Tooltip>
      <Tooltip title="标题3"><button style={{...btnStyle(editor.isActive("heading", { level: 3 })), fontSize: 13, fontWeight: 500}} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</button></Tooltip>

      <div style={{ width: 1, height: 18, background: "var(--border-color, #e8e8e8)", margin: "0 4px" }} />

      <Tooltip title="无序列表"><button style={btnStyle(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()}>☰</button></Tooltip>
      <Tooltip title="有序列表"><button style={btnStyle(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()}>#</button></Tooltip>
      <Tooltip title="引用"><button style={btnStyle(editor.isActive("blockquote"))} onClick={() => editor.chain().focus().toggleBlockquote().run()}>❝</button></Tooltip>

      <div style={{ flex: 1 }} />

      <Tooltip title="撤销"><button style={btnStyle(false)} onClick={() => editor.chain().focus().undo().run()}>↩</button></Tooltip>
      <Tooltip title="重做"><button style={btnStyle(false)} onClick={() => editor.chain().focus().redo().run()}>↪</button></Tooltip>
    </Flex>
  );
}

// ── 编辑器组件（TipTap） ────────────────────────────────────
function NoteEditor({
  content,
  onChange,
}: {
  content: string;
  onChange: (html: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // 不需要 code block / horizontal rule
        code: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      Underline,
      Placeholder.configure({
        placeholder: "记录你的交易思路、理由、反思…",
      }),
    ],
    content,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: "trading-note-editor",
      },
    },
  });

  // 外部更新 content 时同步
  useEffect(() => {
    if (editor && editor.getHTML() !== content) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  if (!editor) return null;

  return (
    <div style={{ border: "1px solid var(--border-color, #f0f0f0)", borderRadius: 8, overflow: "hidden" }}>
      <Toolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

// ── 主体组件 ────────────────────────────────────────────────
export default function TradingNotes() {
  const [notes, setNotes] = useState<TradingNote[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // 加载
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const loaded: TradingNote[] = JSON.parse(raw);
        setNotes(loaded);
      }
    } catch { /* ignore */ }
  }, []);

  // 持久化
  const persist = useCallback((updated: TradingNote[]) => {
    setNotes(updated);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
  }, []);

  // 新建
  const handleNew = useCallback(() => {
    const now = new Date().toISOString();
    const newNote: TradingNote = {
      id: Date.now().toString(36),
      title: `笔记 ${notes.length + 1}`,
      content: "",
      createdAt: now,
      updatedAt: now,
    };
    persist([newNote, ...notes]);
    setActiveId(newNote.id);
    setTitle(newNote.title);
    setContent("");
    setDirty(false);
  }, [notes, persist]);

  // 选中笔记
  const handleSelect = useCallback((note: TradingNote) => {
    setActiveId(note.id);
    setTitle(note.title);
    setContent(note.content);
    setDirty(false);
  }, []);

  // 保存
  const handleSave = useCallback(() => {
    if (!activeId) return;
    const updated = notes.map((n) =>
      n.id === activeId
        ? { ...n, title, content, updatedAt: new Date().toISOString() }
        : n
    );
    persist(updated);
    setDirty(false);
  }, [activeId, notes, title, content, persist]);

  // 删除
  const handleDelete = useCallback(() => {
    if (!deleteConfirmId) return;
    const updated = notes.filter((n) => n.id !== deleteConfirmId);
    persist(updated);
    if (activeId === deleteConfirmId) {
      setActiveId(null);
      setTitle("");
      setContent("");
    }
    setDeleteConfirmId(null);
  }, [deleteConfirmId, notes, persist, activeId]);

  // 快捷键 Ctrl+S 保存
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (activeId && dirty) handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeId, dirty, handleSave]);

  const activeNote = notes.find((n) => n.id === activeId);

  return (
    <section style={{ marginBottom: 16 }}>
      <div
        style={{
          borderRadius: 12,
          background: "var(--bg-card, #fff)",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 0 0 1px rgba(0,0,0,0.04)",
          overflow: "hidden",
        }}
      >
        {/* ── 头部 ── */}
        <Flex
          align="center"
          justify="space-between"
          style={{
            padding: "10px 16px",
            borderBottom: "1px solid var(--border-color, #f0f0f0)",
          }}
        >
          <Flex align="center" gap={8}>
            <FileTextOutlined style={{ color: "var(--text-secondary, #666)" }} />
            <span style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary, #000)" }}>
              📓 交易笔记
            </span>
            <span style={{ fontSize: 12, color: "var(--text-tertiary, #999)" }}>
              共 {notes.length} 篇
            </span>
          </Flex>
          <Button size="small" type="primary" icon={<PlusOutlined />} onClick={handleNew}>
            新笔记
          </Button>
        </Flex>

        <Flex style={{ minHeight: 380 }}>
          {/* ── 笔记列表（左侧）── */}
          <div
            style={{
              width: 220,
              borderRight: "1px solid var(--border-color, #f0f0f0)",
              overflowY: "auto",
              flexShrink: 0,
            }}
          >
            {notes.length === 0 ? (
              <Flex align="center" justify="center" style={{ height: 200 }}>
                <Empty description="暂无笔记" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              </Flex>
            ) : (
              notes.map((note) => (
                <div
                  key={note.id}
                  onClick={() => handleSelect(note)}
                  style={{
                    padding: "10px 14px",
                    cursor: "pointer",
                    borderBottom: "1px solid var(--border-color, #f0f0f0)",
                    background: note.id === activeId ? "var(--accent-bg, #e6f4ff)" : "transparent",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    if (note.id !== activeId) e.currentTarget.style.background = "var(--hover-bg, #f5f5f5)";
                  }}
                  onMouseLeave={(e) => {
                    if (note.id !== activeId) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: note.id === activeId ? 600 : 400,
                      color: "var(--text-primary, #000)",
                      marginBottom: 4,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {note.title}
                  </div>
                  <Flex align="center" gap={4} style={{ fontSize: 11, color: "var(--text-tertiary, #999)" }}>
                    <ClockCircleOutlined style={{ fontSize: 10 }} />
                    <span>{new Date(note.updatedAt).toLocaleDateString("zh-CN")}</span>
                  </Flex>
                </div>
              ))
            )}
          </div>

          {/* ── 编辑区（右侧）── */}
          <div style={{ flex: 1, padding: 16, display: "flex", flexDirection: "column" }}>
            {activeNote ? (
              <>
                <Input
                  value={title}
                  onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
                  variant="borderless"
                  style={{
                    fontSize: 16,
                    fontWeight: 600,
                    padding: 0,
                    marginBottom: 12,
                    color: "var(--text-primary, #000)",
                  }}
                  placeholder="笔记标题"
                />
                <div style={{ flex: 1 }}>
                  <NoteEditor content={content} onChange={(html) => { setContent(html); setDirty(true); }} />
                </div>
                {dirty && (
                  <Flex justify="space-between" align="center" style={{ marginTop: 10 }}>
                    <span style={{ fontSize: 12, color: "var(--text-tertiary, #999)" }}>
                      有未保存的更改
                    </span>
                    <Space>
                      <Button
                        size="small"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={() => setDeleteConfirmId(activeId)}
                      >
                        删除
                      </Button>
                      <Button
                        size="small"
                        type="primary"
                        icon={<SaveOutlined />}
                        onClick={handleSave}
                      >
                        保存 (Ctrl+S)
                      </Button>
                    </Space>
                  </Flex>
                )}
                {!dirty && (
                  <Flex justify="space-between" align="center" style={{ marginTop: 10 }}>
                    <span style={{ fontSize: 12, color: "var(--text-tertiary, #999)" }}>
                      {new Date(activeNote.updatedAt).toLocaleString("zh-CN")}
                    </span>
                    <Button
                      size="small"
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => setDeleteConfirmId(activeId)}
                    >
                      删除
                    </Button>
                  </Flex>
                )}
              </>
            ) : (
              <Flex align="center" justify="center" style={{ flex: 1 }}>
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <span style={{ color: "var(--text-tertiary, #999)", fontSize: 13 }}>
                      选择或新建一篇笔记
                    </span>
                  }
                />
              </Flex>
            )}
          </div>
        </Flex>
      </div>

      {/* ── 删除确认 ── */}
      <Modal
        title="确认删除"
        open={deleteConfirmId !== null}
        onOk={handleDelete}
        onCancel={() => setDeleteConfirmId(null)}
        okText="删除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
      >
        <p style={{ color: "var(--text-secondary, #666)" }}>
          确定要删除这篇笔记吗？此操作不可恢复。
        </p>
      </Modal>
    </section>
  );
}
