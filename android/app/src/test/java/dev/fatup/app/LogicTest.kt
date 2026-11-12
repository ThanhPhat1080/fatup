package dev.fatup.app

import mockwebserver3.MockResponse
import mockwebserver3.MockWebServer
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File

class SetupLinkTest {
    @Test
    fun parsesDesktopQrPayload() {
        val c = SetupLink.parse("fatup://setup?url=https%3A%2F%2Ffatup.me.workers.dev&token=abc_-123")
        assertEquals(Connection("https://fatup.me.workers.dev", "abc_-123"), c)
    }

    @Test
    fun rejectsForeignOrIncompleteLinks() {
        assertNull(SetupLink.parse("https://example.com"))
        assertNull(SetupLink.parse("fatup://setup?url=https%3A%2F%2Fx.dev"))
        assertNull(SetupLink.parse("fatup://other?url=a&token=b"))
        assertNull(SetupLink.parse("not a uri at all %%"))
    }

    @Test
    fun normalizesUrls() {
        assertEquals("https://x.workers.dev", SetupLink.normalizeServerUrl(" x.workers.dev/ "))
        assertEquals("http://192.168.1.5:8787", SetupLink.normalizeServerUrl("http://192.168.1.5:8787"))
        assertNull(SetupLink.normalizeServerUrl(""))
    }
}

class ThumbnailsTest {
    @Test
    fun scalesLongEdgeTo400() {
        assertEquals(400 to 300, Thumbnails.targetSize(4000, 3000))
        assertEquals(225 to 400, Thumbnails.targetSize(3024, 5376))
        assertEquals(120 to 80, Thumbnails.targetSize(120, 80))
        assertEquals(400 to 1, Thumbnails.targetSize(10000, 10))
    }
}

class BatchTest {
    @Test
    fun roundTripsAndTracksProgress() {
        val batch = Batch(listOf(Entry("/a", "a.jpg", "image/jpeg", 10), Entry("/b", "Báo cáo.pdf", "application/pdf", 20)))
        val after = Batch.fromJson(batch.with(0, Entry.State.DONE).toJson())
        assertEquals(1, after.done)
        assertEquals(1, after.nextPending)
        assertEquals("Báo cáo.pdf", after.entries[1].name)

        val finished = after.with(1, Entry.State.FAILED)
        assertNull(finished.nextPending)
        assertEquals(listOf("Báo cáo.pdf"), finished.failed.map { it.name })
    }
}

class FilesTest {
    @Test
    fun copyLimitedStopsAtTheLimit() {
        val out = ByteArrayOutputStream()
        assertEquals(5L, copyLimited(ByteArrayInputStream(ByteArray(5)), out, 5))
        assertThrows(TooLargeException::class.java) { copyLimited(ByteArrayInputStream(ByteArray(6)), ByteArrayOutputStream(), 5) }
    }

    @Test
    fun guessesMimeTypes() {
        assertEquals("image/heic", guessMime("IMG_1.HEIC"))
        assertEquals("application/octet-stream", guessMime("noext"))
        assertTrue(isImage("IMAGE/PNG"))
        assertFalse(isImage("application/pdf"))
    }
}

class ApiTest {
    @Test
    fun fullUploadFlowAgainstFakeServer() {
        MockWebServer().use { server ->
            server.start()
            val base = server.url("").toString().trimEnd('/')
            server.enqueue(MockResponse.Builder().code(201).body("""{"id":"ID1","uploadUrl":"$base/r2/put","thumbUploadUrl":null}""").build())
            server.enqueue(MockResponse.Builder().code(200).build())
            server.enqueue(MockResponse.Builder().code(200).body("""{"id":"ID1"}""").build())

            val api = Api(Connection(base, "tok"))
            val ticket = api.createUpload("a.pdf", "application/pdf", 3, hasThumb = false, device = "Pixel")
            assertEquals("ID1", ticket.id)
            assertNull(ticket.thumbUploadUrl)

            val file = File.createTempFile("fatup", ".pdf").apply { writeText("abc") }
            var progress = 0L
            api.putFile(ticket.uploadUrl, file, "application/pdf") { progress = it }
            api.complete(ticket.id)
            assertEquals(3L, progress)

            val create = server.takeRequest()
            assertEquals("Bearer tok", create.headers["Authorization"])
            val body = JSONObject(create.body!!.utf8())
            assertEquals("a.pdf", body.getString("name"))
            assertEquals("Pixel", body.getString("device"))

            val put = server.takeRequest()
            assertEquals("PUT", put.method)
            assertEquals("abc", put.body!!.utf8())
            assertNull(put.headers["Authorization"]) // presigned URL, no bearer token

            assertEquals("/uploads/ID1/complete", server.takeRequest().url.encodedPath)
        }
    }

    @Test
    fun classifiesErrors() {
        MockWebServer().use { server ->
            server.start()
            val api = Api(Connection(server.url("").toString().trimEnd('/'), "bad"))
            server.enqueue(MockResponse.Builder().code(401).body("""{"error":{"code":"unauthorized","message":"no"}}""").build())
            val auth = assertThrows(ApiException::class.java) { api.verify() }
            assertEquals(401, auth.status)
            assertTrue(auth.permanent)

            server.enqueue(MockResponse.Builder().code(503).build())
            val busy = assertThrows(ApiException::class.java) { api.verify() }
            assertFalse(busy.permanent)
        }
    }
}
