"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Point = {
  x: number;
  y: number;
};

type DrawLine = {
  id: number;
  start: Point;
  end: Point;
};

type SnapAxis = "x" | "y" | null;
type SnapMode = "axis-x" | "axis-y" | "line" | "endpoint" | null;
type GeometrySnapResult = {
  point: Point;
  mode: "line" | "endpoint";
  distance: number;
};

const DEFAULT_CANVAS = {
  width: 1280,
  height: 720,
};

const MIN_LINE_LENGTH = 2;

const distanceBetween = (start: Point, end: Point): number => {
  return Math.hypot(end.x - start.x, end.y - start.y);
};

const formatNumber = (value: number, precision = 2): string => {
  return Number.isFinite(value) ? value.toFixed(precision) : "-";
};

const projectPointOntoSegment = (point: Point, start: Point, end: Point): Point => {
  const vectorX = end.x - start.x;
  const vectorY = end.y - start.y;
  const lengthSquared = vectorX * vectorX + vectorY * vectorY;

  if (lengthSquared === 0) {
    return { ...start };
  }

  const dotProduct = (point.x - start.x) * vectorX + (point.y - start.y) * vectorY;
  const projection = Math.max(0, Math.min(1, dotProduct / lengthSquared));

  return {
    x: start.x + projection * vectorX,
    y: start.y + projection * vectorY,
  };
};

export default function Home() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [canvasSize, setCanvasSize] = useState(DEFAULT_CANVAS);
  const [lines, setLines] = useState<DrawLine[]>([]);
  const [lineHistory, setLineHistory] = useState<DrawLine[][]>([]);
  const [lineFuture, setLineFuture] = useState<DrawLine[][]>([]);
  const linesRef = useRef<DrawLine[]>([]);
  const lineHistoryRef = useRef<DrawLine[][]>([]);
  const lineFutureRef = useRef<DrawLine[][]>([]);
  const [selectedLineId, setSelectedLineId] = useState<number | null>(null);
  const [unitsPerPixel, setUnitsPerPixel] = useState<number | null>(null);
  const [unitLabel, setUnitLabel] = useState("cm");
  const [referenceValue, setReferenceValue] = useState("1");
  const [snapThreshold, setSnapThreshold] = useState(12);
  const [statusText, setStatusText] = useState(
    "Paste an image (Ctrl/Cmd+V), or choose one to begin measuring."
  );
  const [imageMeta, setImageMeta] = useState<{
    name: string;
    width: number;
    height: number;
  } | null>(null);
  const [nextLineId, setNextLineId] = useState(1);
  const [draftStart, setDraftStart] = useState<Point | null>(null);
  const [draftEnd, setDraftEnd] = useState<Point | null>(null);
  const [draftSnapMode, setDraftSnapMode] = useState<SnapMode>(null);
  const [cursor, setCursor] = useState<Point | null>(null);

  useEffect(() => {
    linesRef.current = lines;
  }, [lines]);

  useEffect(() => {
    lineHistoryRef.current = lineHistory;
  }, [lineHistory]);

  useEffect(() => {
    lineFutureRef.current = lineFuture;
  }, [lineFuture]);

  const pushLineHistory = useCallback((nextLines: DrawLine[]) => {
    const currentLines = linesRef.current;
    const nextHistory = [...lineHistoryRef.current, currentLines];

    lineHistoryRef.current = nextHistory;
    lineFutureRef.current = [];
    linesRef.current = nextLines;

    setLineHistory(nextHistory);
    setLineFuture([]);
    setLines(nextLines);
  }, []);

  const clearLineHistory = useCallback(() => {
    lineHistoryRef.current = [];
    lineFutureRef.current = [];
    setLineHistory([]);
    setLineFuture([]);
  }, []);

  const undoLineChange = useCallback(() => {
    const history = lineHistoryRef.current;
    if (history.length === 0) {
      setStatusText("Nothing to undo.");
      return;
    }

    const current = linesRef.current;
    const previous = history[history.length - 1];
    const nextHistory = history.slice(0, -1);
    const nextFuture = [...lineFutureRef.current, current];

    lineHistoryRef.current = nextHistory;
    lineFutureRef.current = nextFuture;
    linesRef.current = previous;

    setLineHistory(nextHistory);
    setLineFuture(nextFuture);
    setLines(previous);
    setSelectedLineId(null);
    setStatusText("Undo.");
  }, []);

  const redoLineChange = useCallback(() => {
    const future = lineFutureRef.current;
    if (future.length === 0) {
      setStatusText("Nothing to redo.");
      return;
    }

    const current = linesRef.current;
    const next = future[future.length - 1];
    const nextFuture = future.slice(0, -1);
    const nextHistory = [...lineHistoryRef.current, current];

    lineHistoryRef.current = nextHistory;
    lineFutureRef.current = nextFuture;
    linesRef.current = next;

    setLineHistory(nextHistory);
    setLineFuture(nextFuture);
    setLines(next);
    setSelectedLineId(null);
    setStatusText("Redo.");
  }, []);

  const selectedLine = useMemo(
    () => lines.find((line) => line.id === selectedLineId) ?? null,
    [lines, selectedLineId]
  );

  const mapPointerToCanvas = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>): Point => {
      const canvas = canvasRef.current;

      if (!canvas) {
        return { x: 0, y: 0 };
      }

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const rawX = (event.clientX - rect.left) * scaleX;
      const rawY = (event.clientY - rect.top) * scaleY;

      return {
        x: Math.min(Math.max(rawX, 0), canvas.width),
        y: Math.min(Math.max(rawY, 0), canvas.height),
      };
    },
    []
  );

  const withAxisSnapping = useCallback(
    (origin: Point, candidate: Point): { point: Point; axis: SnapAxis } => {
      const deltaX = candidate.x - origin.x;
      const deltaY = candidate.y - origin.y;
      const nearXAxis = Math.abs(deltaY) <= snapThreshold;
      const nearYAxis = Math.abs(deltaX) <= snapThreshold;

      if (nearXAxis && nearYAxis) {
        if (Math.abs(deltaY) <= Math.abs(deltaX)) {
          return {
            point: { x: candidate.x, y: origin.y },
            axis: "x",
          };
        }

        return {
          point: { x: origin.x, y: candidate.y },
          axis: "y",
        };
      }

      if (nearXAxis) {
        return {
          point: { x: candidate.x, y: origin.y },
          axis: "x",
        };
      }

      if (nearYAxis) {
        return {
          point: { x: origin.x, y: candidate.y },
          axis: "y",
        };
      }

      return {
        point: candidate,
        axis: null,
      };
    },
    [snapThreshold]
  );

  const getNearestGeometrySnap = useCallback(
    (candidate: Point): GeometrySnapResult | null => {
      let bestSnap: GeometrySnapResult | null = null;

      lines.forEach((line) => {
        const startDistance = distanceBetween(candidate, line.start);
        if (startDistance <= snapThreshold) {
          if (!bestSnap || startDistance < bestSnap.distance) {
            bestSnap = {
              point: line.start,
              mode: "endpoint",
              distance: startDistance,
            };
          }
        }

        const endDistance = distanceBetween(candidate, line.end);
        if (endDistance <= snapThreshold) {
          if (!bestSnap || endDistance < bestSnap.distance) {
            bestSnap = {
              point: line.end,
              mode: "endpoint",
              distance: endDistance,
            };
          }
        }

        const projection = projectPointOntoSegment(candidate, line.start, line.end);
        const segmentDistance = distanceBetween(candidate, projection);
        if (segmentDistance <= snapThreshold) {
          if (!bestSnap || segmentDistance < bestSnap.distance) {
            bestSnap = {
              point: projection,
              mode: "line",
              distance: segmentDistance,
            };
          }
        }
      });

      return bestSnap;
    },
    [lines, snapThreshold]
  );

  const drawScene = useCallback(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);

    if (imageRef.current) {
      context.drawImage(imageRef.current, 0, 0, canvas.width, canvas.height);
    } else {
      const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, "#f9f4e9");
      gradient.addColorStop(1, "#f2ddd0");
      context.fillStyle = gradient;
      context.fillRect(0, 0, canvas.width, canvas.height);
    }

    context.save();
    context.strokeStyle = "rgba(10, 10, 10, 0.14)";
    context.lineWidth = 1;

    for (let x = 0; x <= canvas.width; x += 80) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, canvas.height);
      context.stroke();
    }

    for (let y = 0; y <= canvas.height; y += 80) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(canvas.width, y);
      context.stroke();
    }
    context.restore();

    const drawMeasurementLine = (
      line: DrawLine,
      options?: {
        selected?: boolean;
        draft?: boolean;
      }
    ) => {
      const selected = Boolean(options?.selected);
      const draft = Boolean(options?.draft);
      const lengthPixels = distanceBetween(line.start, line.end);
      const labelText = unitsPerPixel
        ? `${formatNumber(lengthPixels * unitsPerPixel)} ${unitLabel}`
        : `${formatNumber(lengthPixels, 1)} px`;
      const deltaX = line.end.x - line.start.x;
      const deltaY = line.end.y - line.start.y;
      const angle = Math.atan2(deltaY, deltaX);
      const labelX = (line.start.x + line.end.x) / 2;
      const labelY = (line.start.y + line.end.y) / 2 - 12;
      const strokeColor = selected ? "#ff002f" : "#ff2b2b";
      const strokeWidth = selected ? 4 : 3;

      context.save();
      context.strokeStyle = "rgba(255, 255, 255, 0.9)";
      context.lineWidth = strokeWidth + 1.5;
      context.lineCap = "round";

      if (draft) {
        context.setLineDash([10, 8]);
      }

      context.beginPath();
      context.moveTo(line.start.x, line.start.y);
      context.lineTo(line.end.x, line.end.y);
      context.stroke();

      context.strokeStyle = strokeColor;
      context.lineWidth = strokeWidth;
      context.beginPath();
      context.moveTo(line.start.x, line.start.y);
      context.lineTo(line.end.x, line.end.y);
      context.stroke();

      context.setLineDash([]);
      context.fillStyle = strokeColor;
      context.beginPath();
      context.arc(line.start.x, line.start.y, 3.6, 0, Math.PI * 2);
      context.fill();
      context.beginPath();
      context.arc(line.end.x, line.end.y, 3.6, 0, Math.PI * 2);
      context.fill();

      context.translate(labelX, labelY);
      context.rotate(angle);
      context.font = "12px var(--font-mono)";
      const textWidth = context.measureText(labelText).width;
      context.fillStyle = "rgba(12, 12, 12, 0.78)";
      context.fillRect(-textWidth / 2 - 6, -14, textWidth + 12, 18);
      context.fillStyle = "#ffffff";
      context.fillText(labelText, -textWidth / 2, 0);
      context.restore();
    };

    lines.forEach((line) => {
      drawMeasurementLine(line, { selected: line.id === selectedLineId });
    });

    if (draftStart && draftEnd) {
      drawMeasurementLine({ id: -1, start: draftStart, end: draftEnd }, { draft: true });
    }

    if (cursor) {
      context.save();
      context.strokeStyle = "rgba(16, 185, 129, 0.52)";
      context.lineWidth = 1;
      context.setLineDash([4, 4]);
      context.beginPath();
      context.moveTo(cursor.x, 0);
      context.lineTo(cursor.x, canvas.height);
      context.moveTo(0, cursor.y);
      context.lineTo(canvas.width, cursor.y);
      context.stroke();
      context.restore();
    }
  }, [cursor, draftEnd, draftStart, lines, selectedLineId, unitLabel, unitsPerPixel]);

  const clearDraft = useCallback(() => {
    setDraftStart(null);
    setDraftEnd(null);
    setDraftSnapMode(null);
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const point = mapPointerToCanvas(event);
      const snapped = getNearestGeometrySnap(point);
      const initialPoint = snapped?.point ?? point;
      event.currentTarget.setPointerCapture(event.pointerId);
      setDraftStart(initialPoint);
      setDraftEnd(initialPoint);
      setDraftSnapMode(snapped?.mode ?? null);
      setCursor(point);
      setSelectedLineId(null);
    },
    [getNearestGeometrySnap, mapPointerToCanvas]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const rawPoint = mapPointerToCanvas(event);
      setCursor(rawPoint);

      if (!draftStart) {
        return;
      }

      const axisSnap = withAxisSnapping(draftStart, rawPoint);
      const geometrySnap = getNearestGeometrySnap(rawPoint);
      const axisDistance = axisSnap.axis
        ? distanceBetween(rawPoint, axisSnap.point)
        : Number.POSITIVE_INFINITY;
      const geometryDistance = geometrySnap?.distance ?? Number.POSITIVE_INFINITY;

      if (geometrySnap && geometryDistance <= axisDistance) {
        setDraftEnd(geometrySnap.point);
        setDraftSnapMode(geometrySnap.mode);
        return;
      }

      if (axisSnap.axis) {
        setDraftEnd(axisSnap.point);
        setDraftSnapMode(axisSnap.axis === "x" ? "axis-x" : "axis-y");
        return;
      }

      setDraftEnd(rawPoint);
      setDraftSnapMode(null);
    },
    [draftStart, getNearestGeometrySnap, mapPointerToCanvas, withAxisSnapping]
  );

  const onPointerUp = useCallback(() => {
    if (!draftStart || !draftEnd) {
      clearDraft();
      return;
    }

    const lineLength = distanceBetween(draftStart, draftEnd);

    if (lineLength >= MIN_LINE_LENGTH) {
      pushLineHistory([
        ...linesRef.current,
        {
          id: nextLineId,
          start: draftStart,
          end: draftEnd,
        },
      ]);
      setSelectedLineId(nextLineId);
      setNextLineId((current) => current + 1);
      if (!draftSnapMode) {
        setStatusText("Line created.");
      } else if (draftSnapMode === "endpoint") {
        setStatusText("Line created with endpoint snap.");
      } else if (draftSnapMode === "line") {
        setStatusText("Line created with line snap.");
      } else if (draftSnapMode === "axis-x") {
        setStatusText("Line created with X-axis snap.");
      } else {
        setStatusText("Line created with Y-axis snap.");
      }
    }

    clearDraft();
  }, [clearDraft, draftEnd, draftSnapMode, draftStart, nextLineId, pushLineHistory]);

  const onPointerLeave = useCallback(() => {
    setCursor(null);
  }, []);

  const resetMeasurements = useCallback((recordUndoHistory = true) => {
    if (recordUndoHistory && linesRef.current.length > 0) {
      pushLineHistory([]);
    } else {
      linesRef.current = [];
      setLines([]);
    }

    setSelectedLineId(null);
    setUnitsPerPixel(null);
    setReferenceValue("1");
    setStatusText("Measurements cleared.");
  }, [pushLineHistory]);

  const loadImageFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setStatusText("Clipboard/file content is not an image.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) {
        setStatusText("Could not read that image.");
        return;
      }

      const image = new Image();
      image.onload = () => {
        imageRef.current = image;
        setCanvasSize({
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
        setImageMeta({
          name: file.name || "Pasted image",
          width: image.naturalWidth,
          height: image.naturalHeight,
        });
        setLines([]);
        clearLineHistory();
        setSelectedLineId(null);
        setUnitsPerPixel(null);
        setNextLineId(1);
        clearDraft();
        setStatusText("Image loaded. Draw a line, then calibrate units.");
      };

      image.onerror = () => {
        setStatusText("Image decode failed.");
      };

      image.src = dataUrl;
    };

    reader.onerror = () => {
      setStatusText("Could not read that image.");
    };

    reader.readAsDataURL(file);
  }, [clearDraft, clearLineHistory]);

  useEffect(() => {
    const isTextEditingTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      const tagName = target.tagName.toLowerCase();
      return tagName === "input" || tagName === "textarea" || target.isContentEditable;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const commandPressed = event.metaKey || event.ctrlKey;
      if (!commandPressed || event.key.toLowerCase() !== "z") {
        return;
      }

      if (isTextEditingTarget(event.target)) {
        return;
      }

      event.preventDefault();
      if (event.shiftKey) {
        redoLineChange();
        return;
      }

      undoLineChange();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [redoLineChange, undoLineChange]);

  useEffect(() => {
    drawScene();
  }, [drawScene]);

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) {
        return;
      }

      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            event.preventDefault();
            loadImageFile(file);
          }
          return;
        }
      }
    };

    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("paste", onPaste);
    };
  }, [loadImageFile]);

  const applyCalibration = useCallback(() => {
    if (!selectedLine) {
      setStatusText("Select a line first, then set its real-world distance.");
      return;
    }

    const knownDistance = Number(referenceValue);
    if (!Number.isFinite(knownDistance) || knownDistance <= 0) {
      setStatusText("Reference distance must be a positive number.");
      return;
    }

    const pixelDistance = distanceBetween(selectedLine.start, selectedLine.end);
    if (pixelDistance <= 0) {
      setStatusText("Selected line has zero length.");
      return;
    }

    setUnitsPerPixel(knownDistance / pixelDistance);
    setStatusText(`Calibrated: 1 px = ${formatNumber(knownDistance / pixelDistance, 6)} ${unitLabel}`);
  }, [referenceValue, selectedLine, unitLabel]);

  const measurementRows = useMemo(() => {
    return lines.map((line) => {
      const deltaX = line.end.x - line.start.x;
      const deltaY = line.end.y - line.start.y;
      const lengthPx = distanceBetween(line.start, line.end);

      return {
        id: line.id,
        deltaX,
        deltaY,
        lengthPx,
        worldDeltaX: unitsPerPixel ? deltaX * unitsPerPixel : null,
        worldDeltaY: unitsPerPixel ? deltaY * unitsPerPixel : null,
        worldLength: unitsPerPixel ? lengthPx * unitsPerPixel : null,
      };
    });
  }, [lines, unitsPerPixel]);

  const selectedLengthPx = selectedLine
    ? distanceBetween(selectedLine.start, selectedLine.end)
    : null;

  const selectedLengthWorld =
    selectedLengthPx !== null && unitsPerPixel
      ? selectedLengthPx * unitsPerPixel
      : null;

  const cursorText = useMemo(() => {
    if (!cursor) {
      return "Cursor: -";
    }

    if (unitsPerPixel) {
      return `Cursor: (${formatNumber(cursor.x * unitsPerPixel)}, ${formatNumber(cursor.y * unitsPerPixel)}) ${unitLabel}`;
    }

    return `Cursor: (${formatNumber(cursor.x, 1)}, ${formatNumber(cursor.y, 1)}) px`;
  }, [cursor, unitLabel, unitsPerPixel]);

  const deleteSelectedLine = useCallback(() => {
    if (!selectedLineId) {
      return;
    }

    const nextLines = linesRef.current.filter((line) => line.id !== selectedLineId);
    if (nextLines.length === linesRef.current.length) {
      return;
    }

    pushLineHistory(nextLines);
    setSelectedLineId(null);
    setStatusText("Selected line deleted.");
  }, [pushLineHistory, selectedLineId]);

  const clearImage = useCallback(() => {
    imageRef.current = null;
    setImageMeta(null);
    setCanvasSize(DEFAULT_CANVAS);
    clearLineHistory();
    resetMeasurements(false);
    setStatusText("Image removed. Paste or choose a new image.");
  }, [clearLineHistory, resetMeasurements]);

  return (
    <main className="measure-shell">
      <section className="measure-header">
        <h1>Relative</h1>
        <p>
          Paste a photo onto the canvas, draw measurement lines, and calibrate to real units.
          Lines snap to X/Y axes and to nearby line endpoints/segments when your cursor gets close.
        </p>
      </section>

      <section className="measure-layout">
        <aside className="measure-panel">
          <h2>Controls</h2>

          <button
            className="measure-btn"
            type="button"
            onClick={() => fileInputRef.current?.click()}
          >
            Choose Image
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                loadImageFile(file);
              }
              event.currentTarget.value = "";
            }}
            className="measure-hidden-input"
          />

          <button className="measure-btn" type="button" onClick={clearImage}>
            Clear Image
          </button>

          <button className="measure-btn" type="button" onClick={() => resetMeasurements()}>
            Clear Lines
          </button>

          <button
            className="measure-btn"
            type="button"
            onClick={deleteSelectedLine}
            disabled={!selectedLineId}
          >
            Delete Selected
          </button>

          <label className="measure-label" htmlFor="unit-label-input">
            Unit Label
          </label>
          <input
            id="unit-label-input"
            className="measure-input"
            value={unitLabel}
            onChange={(event) => setUnitLabel(event.target.value || "unit")}
            placeholder="cm"
          />

          <label className="measure-label" htmlFor="snap-threshold-input">
            Snap Threshold (Axis + Line): {snapThreshold}px
          </label>
          <input
            id="snap-threshold-input"
            type="range"
            min={2}
            max={30}
            step={1}
            value={snapThreshold}
            onChange={(event) => setSnapThreshold(Number(event.target.value))}
          />

          <h2>Calibration</h2>
          <p className="measure-help">
            Draw a known reference line, select it in the list, enter its real-world value, then apply.
          </p>

          <label className="measure-label" htmlFor="reference-input">
            Reference Distance ({unitLabel})
          </label>
          <input
            id="reference-input"
            className="measure-input"
            value={referenceValue}
            onChange={(event) => setReferenceValue(event.target.value)}
          />
          <button className="measure-btn measure-btn-highlight" type="button" onClick={applyCalibration}>
            Use Selected Line as Reference
          </button>

          <div className="measure-stats">
            <div>
              <span>Image</span>
              <strong>
                {imageMeta
                  ? `${imageMeta.name} (${imageMeta.width} x ${imageMeta.height}px)`
                  : "No image loaded"}
              </strong>
            </div>
            <div>
              <span>Scale</span>
              <strong>
                {unitsPerPixel
                  ? `1 px = ${formatNumber(unitsPerPixel, 6)} ${unitLabel}`
                  : "Not calibrated"}
              </strong>
            </div>
            <div>
              <span>{cursorText}</span>
            </div>
            <div>
              <span>Status</span>
              <strong>{statusText}</strong>
            </div>
            {selectedLine && (
              <div>
                <span>Selected Line</span>
                <strong>
                  #{selectedLine.id}: {formatNumber(selectedLengthPx ?? 0, 1)} px
                  {selectedLengthWorld ? ` (${formatNumber(selectedLengthWorld)} ${unitLabel})` : ""}
                </strong>
              </div>
            )}
          </div>
        </aside>

        <section className="measure-workbench">
          <div className="measure-canvas-wrap">
            <canvas
              ref={canvasRef}
              width={canvasSize.width}
              height={canvasSize.height}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerLeave}
              onPointerCancel={onPointerUp}
              className="measure-canvas"
            />
          </div>

          <div className="measure-lines">
            <h2>Measurements</h2>
            {measurementRows.length === 0 && (
              <p className="measure-help">
                No lines yet. Draw on the canvas with your mouse or trackpad.
              </p>
            )}

            {measurementRows.length > 0 && (
              <ul>
                {measurementRows.map((row) => {
                  const isSelected = selectedLineId === row.id;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        className={`measure-line-row ${isSelected ? "is-selected" : ""}`}
                        onClick={() => setSelectedLineId(row.id)}
                      >
                        <strong>Line #{row.id}</strong>
                        <span>
                          Length: {formatNumber(row.lengthPx, 1)} px
                          {row.worldLength !== null
                            ? ` | ${formatNumber(row.worldLength)} ${unitLabel}`
                            : ""}
                        </span>
                        <span>
                          ΔX: {formatNumber(row.deltaX, 1)} px
                          {row.worldDeltaX !== null
                            ? ` | ${formatNumber(row.worldDeltaX)} ${unitLabel}`
                            : ""}
                        </span>
                        <span>
                          ΔY: {formatNumber(row.deltaY, 1)} px
                          {row.worldDeltaY !== null
                            ? ` | ${formatNumber(row.worldDeltaY)} ${unitLabel}`
                            : ""}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
