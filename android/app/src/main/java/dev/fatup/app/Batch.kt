package dev.fatup.app

import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** One shared file waiting in the app's cache to be uploaded. */
data class Entry(
    val path: String,
    val name: String,
    val mime: String,
    val size: Long,
    val state: State = State.PENDING,
) {
    enum class State { PENDING, DONE, FAILED }
}

/** A share action (one or many files), persisted so retries survive process death. */
data class Batch(val entries: List<Entry>) {
    val total get() = entries.size
    val done get() = entries.count { it.state == Entry.State.DONE }
    val failed get() = entries.filter { it.state == Entry.State.FAILED }
    val nextPending get() = entries.indexOfFirst { it.state == Entry.State.PENDING }.takeIf { it >= 0 }

    fun with(index: Int, state: Entry.State) = copy(entries = entries.mapIndexed { i, e -> if (i == index) e.copy(state = state) else e })

    fun toJson(): String = JSONObject().put(
        "entries",
        JSONArray(entries.map {
            JSONObject().put("path", it.path).put("name", it.name).put("mime", it.mime).put("size", it.size).put("state", it.state.name)
        }),
    ).toString()

    fun save(file: File) {
        val tmp = File(file.path + ".tmp")
        tmp.writeText(toJson())
        tmp.renameTo(file)
    }

    companion object {
        fun fromJson(json: String): Batch {
            val arr = JSONObject(json).getJSONArray("entries")
            return Batch((0 until arr.length()).map { i ->
                val o = arr.getJSONObject(i)
                Entry(o.getString("path"), o.getString("name"), o.getString("mime"), o.getLong("size"), Entry.State.valueOf(o.getString("state")))
            })
        }

        fun load(file: File): Batch? = runCatching { fromJson(file.readText()) }.getOrNull()
    }
}
