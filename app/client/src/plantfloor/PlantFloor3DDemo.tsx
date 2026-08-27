import React, { useState, useMemo } from 'react';
import { PlantFloor3DPerformant } from './PlantFloor3DPerformant';
import { generateMockLines } from './mockData';

export const PlantFloor3DDemo: React.FC = () => {
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null);
  const [lineCount, setLineCount] = useState(1200);

  const mockLines = useMemo(() => {
    return generateMockLines(lineCount);
  }, [lineCount]);

  const selectedLine = useMemo(() => {
    return mockLines.find((l) => l.lineId === selectedLineId);
  }, [mockLines, selectedLineId]);

  return (
    <div className="w-full h-screen flex flex-col bg-slate-950">
      <div className="flex-1 relative">
        <PlantFloor3DPerformant
          lines={mockLines}
          onSelectLine={setSelectedLineId}
          heroLineId="LINE-04"
        />

        <div className="absolute top-6 left-6 z-10 bg-slate-900/80 backdrop-blur border border-slate-800 rounded-lg p-4 max-w-xs">
          <h2 className="text-sm font-bold text-amber-400 mb-3">Volta Plant Floor</h2>
          <div className="space-y-2 text-xs text-slate-300">
            <div>
              <span className="text-slate-400">Lines rendered:</span>
              <span className="ml-2 font-mono font-semibold text-slate-100">{mockLines.length}</span>
            </div>
            <div>
              <span className="text-slate-400">At-risk lines:</span>
              <span className="ml-2 font-mono font-semibold text-red-400">
                {mockLines.filter((l) => l.riskBand !== 'healthy').length}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Critical:</span>
              <span className="ml-2 font-mono font-semibold text-red-500">
                {mockLines.filter((l) => l.riskBand === 'critical').length}
              </span>
            </div>
          </div>
        </div>

        {selectedLine && (
          <div className="absolute bottom-6 right-6 z-10 bg-slate-900/90 backdrop-blur border border-amber-600/40 rounded-lg p-4 max-w-sm">
            <h3 className="text-sm font-bold text-amber-400 mb-3">{selectedLine.lineId}</h3>
            <div className="space-y-2 text-xs text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-400">Name:</span>
                <span className="font-mono">{selectedLine.lineName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Plant:</span>
                <span className="font-mono">{selectedLine.plantId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Machine:</span>
                <span className="font-mono">{selectedLine.machineType}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Risk Band:</span>
                <span
                  className={`font-mono font-semibold ${
                    selectedLine.riskBand === 'critical'
                      ? 'text-red-500'
                      : selectedLine.riskBand === 'elevated' || selectedLine.riskBand === 'watch'
                        ? 'text-amber-400'
                        : 'text-green-400'
                  }`}
                >
                  {selectedLine.riskBand}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Failure Risk:</span>
                <span className="font-mono">{(selectedLine.failureRiskScore * 100).toFixed(1)}%</span>
              </div>
              {selectedLine.vibrationRms && (
                <div className="flex justify-between">
                  <span className="text-slate-400">Vibration RMS:</span>
                  <span className="font-mono">{selectedLine.vibrationRms.toFixed(2)} g</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 bg-slate-900 border-t border-slate-800 p-4 space-y-3">
        <div>
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Line Count</label>
          <input
            type="range"
            min="100"
            max="1200"
            step="100"
            value={lineCount}
            onChange={(e) => setLineCount(Number(e.target.value))}
            className="w-full mt-1"
          />
          <div className="text-xs text-slate-500 mt-1">{lineCount} lines</div>
        </div>
        <div className="flex gap-2 text-xs">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500 shadow-lg shadow-red-500/50"></div>
            <span className="text-slate-300">Critical</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-amber-400"></div>
            <span className="text-slate-300">At Risk</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-blue-400"></div>
            <span className="text-slate-300">Healthy</span>
          </div>
        </div>
      </div>
    </div>
  );
};
