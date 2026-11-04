import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { RunType, RunStatus } from '../types/domain';
import { RunStatusBadge } from '../components/shared/StatusBadge';
import { EmptyState } from '../components/shared/EmptyState';
import {
  History,
  Search,
  Filter,
  FileCode,
  ShieldCheck,
  ArrowRight,
  RotateCcw
} from 'lucide-react';

export function Runs() {
  const { runs, navigateTo } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState<RunType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<RunStatus | 'all'>('all');

  const filteredRuns = runs.filter((run) => {
    if (typeFilter !== 'all' && run.type !== typeFilter) return false;
    if (statusFilter !== 'all' && run.status !== statusFilter) return false;
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      const matchTitle = run.title.toLowerCase().includes(term);
      const matchDiag = run.diagnosis?.toLowerCase().includes(term) || false;
      const matchInput = run.errorInput?.toLowerCase().includes(term) || false;
      return matchTitle || matchDiag || matchInput;
    }
    return true;
  });

  const handleOpenRun = (runId: string, runType: RunType) => {
    if (runType === 'code_fix') {
      navigateTo('fix_code', { runId });
    } else {
      navigateTo('verify_answer', { runId });
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-6 border-b border-[#E3EAE6]">
        <div>
          <div className="text-xs font-semibold text-[#08775E] uppercase tracking-wider mb-1">
            Execution Log
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-[#17201D]">
            Runs
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-[#66736F]">
            Review previous analyses, verification results, and patch decisions.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => navigateTo('fix_code')}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-[#08775E] hover:bg-[#065E4B] rounded-lg transition-colors shadow-xs cursor-pointer"
          >
            New Code Fix
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-3.5 bg-white border border-[#E3EAE6] rounded-xl shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-[#66736F] absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search runs by title or symptom..."
            className="w-full pl-9 pr-3 py-1.5 text-xs text-[#17201D] placeholder:text-[#66736F]/70 bg-[#F8FAF9] border border-[#E3EAE6] rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#08775E] focus:bg-white transition-all"
          />
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Type Filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-[#66736F]">Type:</span>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as RunType | 'all')}
              className="py-1 px-2 text-xs font-medium text-[#17201D] bg-[#F8FAF9] border border-[#E3EAE6] rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#08775E] cursor-pointer"
            >
              <option value="all">All Types</option>
              <option value="code_fix">Code Fix</option>
              <option value="answer_verification">Answer Verification</option>
            </select>
          </div>

          {/* Status Filter */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-[#66736F]">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as RunStatus | 'all')}
              className="py-1 px-2 text-xs font-medium text-[#17201D] bg-[#F8FAF9] border border-[#E3EAE6] rounded-lg focus:outline-hidden focus:ring-1 focus:ring-[#08775E] cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="awaiting_approval">Awaiting approval</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="completed">Completed</option>
              <option value="in_progress">In progress</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table / List */}
      {filteredRuns.length === 0 ? (
        <EmptyState
          icon={History}
          title="No matching runs found"
          description="Try adjusting your search terms or filters to find previous diagnostic runs."
          action={{
            label: 'Clear Filters',
            onClick: () => {
              setSearchTerm('');
              setTypeFilter('all');
              setStatusFilter('all');
            }
          }}
        />
      ) : (
        <div className="bg-white border border-[#E3EAE6] rounded-xl shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F8FAF9] border-b border-[#E3EAE6] text-[11px] font-semibold text-[#66736F] uppercase tracking-wider">
                  <th className="py-3 px-4">Run Title & Type</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Created Date</th>
                  <th className="py-3 px-4 text-right">Tokens</th>
                  <th className="py-3 px-4 text-right">Est. Cost</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E3EAE6] text-xs">
                {filteredRuns.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() => handleOpenRun(run.id, run.type)}
                    className="hover:bg-[#F8FAF9] transition-colors cursor-pointer group"
                  >
                    <td className="py-3.5 px-4 min-w-[240px]">
                      <div className="flex items-center gap-3">
                        <div className="p-2 rounded-md bg-[#F8FAF9] border border-[#E3EAE6] text-[#66736F] group-hover:border-[#08775E]/30 shrink-0">
                          {run.type === 'code_fix' ? (
                            <FileCode className="w-4 h-4 text-[#08775E]" />
                          ) : (
                            <ShieldCheck className="w-4 h-4 text-emerald-600" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="font-semibold text-[#17201D] group-hover:text-[#08775E] transition-colors truncate">
                            {run.title}
                          </div>
                          <div className="text-[11px] text-[#66736F] mt-0.5">
                            {run.type === 'code_fix' ? 'Code Fix Agent' : 'Answer Verification'}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <RunStatusBadge status={run.status} />
                    </td>

                    <td className="py-3.5 px-4 text-[#66736F] whitespace-nowrap font-mono">
                      {new Date(run.createdAt).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      })}
                    </td>

                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#17201D]">
                      {run.usage.totalTokens.toLocaleString()}
                    </td>

                    <td className="py-3.5 px-4 text-right font-mono tabular-nums text-[#66736F]">
                      ${run.usage.estimatedCost.toFixed(4)}
                    </td>

                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-[#08775E] group-hover:translate-x-0.5 transition-transform">
                        <span>Inspect</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
