'use client'

import { useEffect, useState } from 'react'
import { clampMaxParallel } from '@/lib/config'
import { useAppStore } from '@/lib/store'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const config = useAppStore((state) => state.config)
  const setConfig = useAppStore((state) => state.setConfig)
  const [agent, setAgent] = useState(config.agent)
  const [workDir, setWorkDir] = useState(config.workDir)
  const [maxParallel, setMaxParallel] = useState(String(config.maxParallel))

  useEffect(() => {
    if (!open) {
      return
    }

    setAgent(config.agent)
    setWorkDir(config.workDir)
    setMaxParallel(String(config.maxParallel))
  }, [config.agent, config.maxParallel, config.workDir, open])

  function handleSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedWorkDir = workDir.trim()

    if (!trimmedWorkDir) {
      return
    }

    setConfig({
      agent,
      workDir: trimmedWorkDir,
      maxParallel: clampMaxParallel(Number(maxParallel)),
    })
    onClose()
  }

  if (!open) {
    return null
  }

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-gray-950/80 p-6 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-3xl border border-gray-800 bg-gray-900 p-6 shadow-2xl shadow-black/50">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-white">设置</h2>
            <p className="mt-1 text-sm text-gray-400">配置默认代理后端、工作目录和并行构建数量。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-gray-700 px-3 py-1 text-xs uppercase tracking-[0.2em] text-gray-300 transition hover:border-gray-500 hover:text-white"
          >
            关闭
          </button>
        </div>

        <form onSubmit={handleSave} className="space-y-5">
          <fieldset className="space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
              Agent后端
            </legend>
            <label className="flex items-center gap-3 rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3 text-sm text-white">
              <input
                type="radio"
                name="agent-backend"
                value="claude-code"
                checked={agent === 'claude-code'}
                onChange={() => setAgent('claude-code')}
                className="h-4 w-4 accent-cyan-500"
              />
              <span>Claude Code</span>
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-gray-800 bg-gray-950 px-4 py-3 text-sm text-white">
              <input
                type="radio"
                name="agent-backend"
                value="codex"
                checked={agent === 'codex'}
                onChange={() => setAgent('codex')}
                className="h-4 w-4 accent-cyan-500"
              />
              <span>Codex</span>
            </label>
          </fieldset>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
              工作目录
            </span>
            <input
              type="text"
              value={workDir}
              onChange={(event) => setWorkDir(event.target.value)}
              placeholder="E:\\projects\\my-app"
              className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">
              最大并行数
            </span>
            <input
              type="number"
              min={1}
              max={5}
              inputMode="numeric"
              value={maxParallel}
              onChange={(event) => setMaxParallel(event.target.value)}
              className="w-full rounded-2xl border border-gray-700 bg-gray-950 px-4 py-3 text-sm text-white outline-none transition focus:border-cyan-500"
            />
          </label>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-gray-700 px-4 py-2 text-sm text-gray-300 transition hover:border-gray-500 hover:text-white"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={!workDir.trim()}
              className="rounded-xl border border-cyan-500/60 bg-cyan-500/10 px-4 py-2 text-sm font-medium text-cyan-100 transition hover:border-cyan-400 hover:bg-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              保存
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
