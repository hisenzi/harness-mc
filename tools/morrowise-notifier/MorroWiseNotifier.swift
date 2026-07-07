import AppKit
import Foundation
import SQLite3
import UserNotifications

let schemaVersion = "notification.v0"
let allowedFields: Set<String> = [
    "schema_version",
    "id",
    "level",
    "title",
    "body",
    "created_at",
    "ttl_seconds",
    "dedupe_key",
    "source",
    "task_anchor"
]
let forbiddenFields: Set<String> = [
    "command",
    "script",
    "script_path",
    "shell",
    "args",
    "action",
    "action_url",
    "callback",
    "delete_path",
    "write_path"
]
let allowedLevels: Set<String> = ["info", "watch", "amber", "red"]

struct NotificationEntry {
    let id: String
    let level: String
    let title: String
    let body: String
    let createdAt: Date
    let ttlSeconds: Int
    let dedupeKey: String
}

final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }
}

enum NotifierError: Error, CustomStringConvertible {
    case usage
    case noBookmark
    case invalidBookmark
    case fileAccessDenied
    case invalidEntry(String)
    case sqlite(String)
    case notificationPermissionDenied

    var description: String {
        switch self {
        case .usage:
            return "usage: MorroWiseNotifier --select-outbox | --poll-once | --diagnose | --notification-status"
        case .noBookmark:
            return "No outbox file has been selected yet. Run --select-outbox."
        case .invalidBookmark:
            return "Stored outbox bookmark could not be resolved."
        case .fileAccessDenied:
            return "Cannot access selected outbox file."
        case .invalidEntry(let message):
            return "Invalid notification entry: \(message)"
        case .sqlite(let message):
            return "Delivered store error: \(message)"
        case .notificationPermissionDenied:
            return "Notification permission denied."
        }
    }
}

let appSupport = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/MorroWiseNotifier", isDirectory: true)
let bookmarkURL = appSupport.appendingPathComponent("outbox.bookmark")
let deliveredStoreURL = appSupport.appendingPathComponent("delivered.sqlite")
let notificationDelegate = NotificationDelegate()

func parseISO8601Date(_ value: String) -> Date? {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = fractional.date(from: value) {
        return date
    }

    let plain = ISO8601DateFormatter()
    plain.formatOptions = [.withInternetDateTime]
    return plain.date(from: value)
}

func formatISO8601Date(_ date: Date) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter.string(from: date)
}

do {
    try FileManager.default.createDirectory(at: appSupport, withIntermediateDirectories: true)
    let args = CommandLine.arguments.dropFirst()
    if args.contains("--select-outbox") {
        try selectOutbox()
    } else if args.contains("--poll-once") {
        try pollOnce()
    } else if args.contains("--diagnose") {
        diagnose()
    } else if args.contains("--notification-status") {
        notificationStatus()
    } else {
        throw NotifierError.usage
    }
} catch {
    fputs("MorroWiseNotifier: \(error)\n", stderr)
    exit(1)
}

func selectOutbox() throws {
    prepareAppRuntime(activate: true)

    let panel = NSOpenPanel()
    panel.title = "Select MorroWise notification outbox"
    panel.canChooseFiles = true
    panel.canChooseDirectories = false
    panel.allowsMultipleSelection = false
    panel.prompt = "Select Outbox"

    guard panel.runModal() == .OK, let selected = panel.url else {
        throw NotifierError.fileAccessDenied
    }

    let bookmark = try selected.bookmarkData(options: [.withSecurityScope], includingResourceValuesForKeys: nil, relativeTo: nil)
    try bookmark.write(to: bookmarkURL, options: [.atomic])
    print("outbox selected: \(selected.path)")
}

func pollOnce() throws {
    let outbox = try resolveOutboxURL()
    let entries = try readEntries(from: outbox)
    let store = try DeliveredStore(path: deliveredStoreURL.path)
    defer { store.close() }

    let now = Date()
    let eligible = entries.filter { entry in
        if store.contains(entry.id) || store.contains(entry.dedupeKey) { return false }
        return entry.createdAt.addingTimeInterval(TimeInterval(entry.ttlSeconds)) >= now
    }

    guard let entry = eligible.sorted(by: { $0.createdAt < $1.createdAt }).first else {
        print("no pending notification")
        return
    }

    try deliver(entry)
    try store.markDelivered(entry.id)
    try store.markDelivered(entry.dedupeKey)
    print("notification delivered: \(entry.id)")
}

func diagnose() {
    let hasBookmark = FileManager.default.fileExists(atPath: bookmarkURL.path)
    let hasDeliveredStore = FileManager.default.fileExists(atPath: deliveredStoreURL.path)
    print("bookmark_configured=\(hasBookmark)")
    print("delivered_store_exists=\(hasDeliveredStore)")
    print("delivered_store=\(deliveredStoreURL.path)")
}

func notificationStatus() {
    prepareAppRuntime(activate: false)
    let semaphore = DispatchSemaphore(value: 0)
    UNUserNotificationCenter.current().getNotificationSettings { settings in
        print("authorization_status=\(describe(settings.authorizationStatus))")
        semaphore.signal()
    }
    semaphore.wait()
}

func describe(_ status: UNAuthorizationStatus) -> String {
    switch status {
    case .notDetermined:
        return "not_determined"
    case .denied:
        return "denied"
    case .authorized:
        return "authorized"
    case .provisional:
        return "provisional"
    case .ephemeral:
        return "ephemeral"
    @unknown default:
        return "unknown"
    }
}

func resolveOutboxURL() throws -> URL {
    guard FileManager.default.fileExists(atPath: bookmarkURL.path) else {
        throw NotifierError.noBookmark
    }

    let data = try Data(contentsOf: bookmarkURL)
    var stale = false
    let url = try URL(resolvingBookmarkData: data, options: [.withSecurityScope], relativeTo: nil, bookmarkDataIsStale: &stale)
    if stale {
        throw NotifierError.invalidBookmark
    }
    guard url.startAccessingSecurityScopedResource() else {
        throw NotifierError.fileAccessDenied
    }
    return url
}

func readEntries(from url: URL) throws -> [NotificationEntry] {
    guard FileManager.default.fileExists(atPath: url.path) else {
        return []
    }

    let content = try String(contentsOf: url, encoding: .utf8)
    return try content
        .split(whereSeparator: \.isNewline)
        .map { line in try parseEntry(String(line)) }
}

func parseEntry(_ line: String) throws -> NotificationEntry {
    let data = Data(line.utf8)
    let object = try JSONSerialization.jsonObject(with: data)
    guard let json = object as? [String: Any] else {
        throw NotifierError.invalidEntry("entry must be a JSON object")
    }

    for key in json.keys {
        if !allowedFields.contains(key) {
            throw NotifierError.invalidEntry("unknown field \(key)")
        }
        if forbiddenFields.contains(key) {
            throw NotifierError.invalidEntry("forbidden field \(key)")
        }
    }

    guard let version = json["schema_version"] as? String, version == schemaVersion else {
        throw NotifierError.invalidEntry("schema_version must be \(schemaVersion)")
    }
    guard let id = json["id"] as? String, !id.isEmpty else {
        throw NotifierError.invalidEntry("id is required")
    }
    guard let level = json["level"] as? String, allowedLevels.contains(level) else {
        throw NotifierError.invalidEntry("level is invalid")
    }
    guard let title = json["title"] as? String, !title.isEmpty, title.count <= 80 else {
        throw NotifierError.invalidEntry("title is invalid")
    }
    guard let body = json["body"] as? String, !body.isEmpty, body.count <= 240 else {
        throw NotifierError.invalidEntry("body is invalid")
    }
    guard let createdAtString = json["created_at"] as? String,
          let createdAt = parseISO8601Date(createdAtString) else {
        throw NotifierError.invalidEntry("created_at is invalid")
    }
    guard let ttlSeconds = json["ttl_seconds"] as? Int, ttlSeconds >= 60, ttlSeconds <= 86400 else {
        throw NotifierError.invalidEntry("ttl_seconds is invalid")
    }
    guard let dedupeKey = json["dedupe_key"] as? String, !dedupeKey.isEmpty else {
        throw NotifierError.invalidEntry("dedupe_key is required")
    }

    return NotificationEntry(
        id: id,
        level: level,
        title: title,
        body: body,
        createdAt: createdAt,
        ttlSeconds: ttlSeconds,
        dedupeKey: dedupeKey
    )
}

func deliver(_ entry: NotificationEntry) throws {
    prepareAppRuntime(activate: false)
    let center = UNUserNotificationCenter.current()
    center.delegate = notificationDelegate
    let semaphore = DispatchSemaphore(value: 0)
    var granted = false

    center.requestAuthorization(options: [.alert, .sound]) { isGranted, _ in
        granted = isGranted
        semaphore.signal()
    }
    semaphore.wait()

    guard granted else {
        throw NotifierError.notificationPermissionDenied
    }

    let content = UNMutableNotificationContent()
    content.title = entry.title
    content.subtitle = entry.level
    content.body = entry.body
    content.sound = .default

    let request = UNNotificationRequest(identifier: entry.id, content: content, trigger: nil)
    let deliverySemaphore = DispatchSemaphore(value: 0)
    var deliveryError: Error?
    center.add(request) { error in
        deliveryError = error
        deliverySemaphore.signal()
    }
    deliverySemaphore.wait()

    if let deliveryError {
        throw deliveryError
    }
}

func prepareAppRuntime(activate: Bool) {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.finishLaunching()
    if activate {
        app.activate(ignoringOtherApps: true)
    }
}

final class DeliveredStore {
    private var db: OpaquePointer?

    init(path: String) throws {
        if sqlite3_open(path, &db) != SQLITE_OK {
            throw NotifierError.sqlite("open failed")
        }
        try execute("CREATE TABLE IF NOT EXISTS delivered (key TEXT PRIMARY KEY, delivered_at TEXT NOT NULL)")
    }

    func contains(_ key: String) -> Bool {
        let sql = "SELECT 1 FROM delivered WHERE key = ? LIMIT 1"
        var statement: OpaquePointer?
        defer { sqlite3_finalize(statement) }
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else { return false }
        return key.withCString { keyPointer in
            sqlite3_bind_text(statement, 1, keyPointer, -1, SQLITE_TRANSIENT)
            return sqlite3_step(statement) == SQLITE_ROW
        }
    }

    func markDelivered(_ key: String) throws {
        let sql = "INSERT OR IGNORE INTO delivered (key, delivered_at) VALUES (?, ?)"
        var statement: OpaquePointer?
        defer { sqlite3_finalize(statement) }
        guard sqlite3_prepare_v2(db, sql, -1, &statement, nil) == SQLITE_OK else {
            throw NotifierError.sqlite("prepare insert failed")
        }
        let deliveredAt = formatISO8601Date(Date())
        let inserted = key.withCString { keyPointer in
            deliveredAt.withCString { deliveredAtPointer in
                sqlite3_bind_text(statement, 1, keyPointer, -1, SQLITE_TRANSIENT)
                sqlite3_bind_text(statement, 2, deliveredAtPointer, -1, SQLITE_TRANSIENT)
                return sqlite3_step(statement) == SQLITE_DONE
            }
        }
        guard inserted else {
            throw NotifierError.sqlite("insert failed")
        }
    }

    func close() {
        sqlite3_close(db)
        db = nil
    }

    private func execute(_ sql: String) throws {
        var error: UnsafeMutablePointer<Int8>?
        if sqlite3_exec(db, sql, nil, nil, &error) != SQLITE_OK {
            let message = error.map { String(cString: $0) } ?? "unknown sqlite error"
            sqlite3_free(error)
            throw NotifierError.sqlite(message)
        }
    }
}

private let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)
