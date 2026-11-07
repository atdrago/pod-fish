// Transcribe an audio file with the on-device speech model of macOS 26 or later.
//
// usage: swift scripts/transcripts/transcribe.swift <audio file> <segments.json>
//
// The output is a JSON array of segments. Each segment holds its start and end in seconds,
// its text, and its words with their own times. `build_transcripts.py` turns it into VTT,
// SRT, and Podcasting 2.0 JSON files. The first run downloads the English model once.

import AVFoundation
import Foundation
import Speech

struct Word: Codable {
  let text: String
  let start: Double
  let end: Double
}

struct Segment: Codable {
  let start: Double
  let end: Double
  let text: String
  let words: [Word]
}

enum TranscribeFailure: Error {
  case usage
  case localeUnsupported
  case assetMissing(String)
  case emptyFile
}

func log(_ message: String) {
  FileHandle.standardError.write(Data((message + "\n").utf8))
}

func seconds(_ time: CMTime) -> Double {
  CMTimeGetSeconds(time)
}

func run() async throws {
  let arguments = CommandLine.arguments
  guard arguments.count == 3 else {
    log("usage: transcribe <audio file> <output json>")
    throw TranscribeFailure.usage
  }
  let inputUrl = URL(fileURLWithPath: arguments[1])
  let outputUrl = URL(fileURLWithPath: arguments[2])

  guard
    let locale = await SpeechTranscriber.supportedLocale(
      equivalentTo: Locale(identifier: "en-US"))
  else { throw TranscribeFailure.localeUnsupported }
  log("locale \(locale.identifier)")

  let transcriber = SpeechTranscriber(
    locale: locale,
    transcriptionOptions: [],
    reportingOptions: [],
    attributeOptions: [.audioTimeRange])
  let modules: [any SpeechModule] = [transcriber]

  if let installationRequest = try await AssetInventory.assetInstallationRequest(
    supporting: modules)
  {
    log("downloading the speech model")
    try await installationRequest.downloadAndInstall()
  }
  let status = await AssetInventory.status(forModules: modules)
  guard status == .installed else {
    throw TranscribeFailure.assetMissing(String(describing: status))
  }
  log("model installed")

  let file = try AVAudioFile(forReading: inputUrl)
  guard file.length > 0 else { throw TranscribeFailure.emptyFile }
  let totalSeconds = Double(file.length) / file.processingFormat.sampleRate
  log("audio \(Int(totalSeconds)) s")

  let analyzer = SpeechAnalyzer(modules: modules)
  let resultsTask = Task<[Segment], Error> {
    var segments: [Segment] = []
    for try await result in transcriber.results {
      guard result.isFinal else { continue }
      var words: [Word] = []
      for run in result.text.runs {
        guard let timeRange = run.audioTimeRange else { continue }
        let text = String(result.text[run.range].characters)
          .trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { continue }
        words.append(
          Word(
            text: text,
            start: seconds(timeRange.start),
            end: seconds(CMTimeRangeGetEnd(timeRange))))
      }
      let start = seconds(result.range.start)
      let end = seconds(CMTimeRangeGetEnd(result.range))
      segments.append(
        Segment(start: start, end: end, text: String(result.text.characters), words: words))
      if segments.count % 20 == 0 {
        log("progress \(Int(end)) / \(Int(totalSeconds)) s, \(segments.count) segments")
      }
    }
    return segments
  }

  let startedAt = Date()
  if let lastInputTime = try await analyzer.analyzeSequence(from: file) {
    try await analyzer.finalizeAndFinish(through: lastInputTime)
  } else {
    await analyzer.cancelAndFinishNow()
  }
  let segments = try await resultsTask.value
  log("done: \(segments.count) segments in \(Int(Date().timeIntervalSince(startedAt))) s")

  let encoder = JSONEncoder()
  encoder.outputFormatting = [.sortedKeys]
  try encoder.encode(segments).write(to: outputUrl)
}

Task {
  do {
    try await run()
    exit(0)
  } catch {
    log("error: \(error)")
    exit(1)
  }
}

RunLoop.main.run()
