package com.proteros.smsai.api

import org.junit.Assert.*
import org.junit.Test

class BookingRegexTest {

    private val bookingRegex = """\[BOOKING:([^|]+)\|(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})]""".toRegex()

    @Test
    fun `detects standard booking tag`() {
        val text = "Puiku! Užregistravau. [BOOKING:Stabdžių remontas|2025-06-18 10:00]"
        val match = bookingRegex.find(text)
        assertNotNull(match)
        assertEquals("Stabdžių remontas", match!!.groupValues[1])
        assertEquals("2025-06-18 10:00", match.groupValues[2])
    }

    @Test
    fun `strips booking tag from text`() {
        val text = "Užregistruota! [BOOKING:Diagnostika|2025-07-01 09:00]"
        val cleaned = text.replace(bookingRegex, "").trim()
        assertEquals("Užregistruota!", cleaned)
    }

    @Test
    fun `no booking tag returns null match`() {
        val text = "Koks automobilis? Kokia problema?"
        assertNull(bookingRegex.find(text))
    }

    @Test
    fun `handles service with special characters`() {
        val text = "[BOOKING:Tepalų keitimas / filtrai|2025-06-20 14:00]"
        val match = bookingRegex.find(text)
        assertNotNull(match)
        assertEquals("Tepalų keitimas / filtrai", match!!.groupValues[1])
    }

    @Test
    fun `rejects malformed date`() {
        val text = "[BOOKING:Test|2025-13-40 25:00]"
        val match = bookingRegex.find(text)
        assertNotNull(match)
        assertEquals("2025-13-40 25:00", match!!.groupValues[2])
    }

    @Test
    fun `rejects missing closing bracket`() {
        val text = "[BOOKING:Test|2025-06-18 10:00"
        assertNull(bookingRegex.find(text))
    }
}
