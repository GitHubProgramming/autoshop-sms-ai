package com.proteros.smsai.util

import org.junit.Assert.assertEquals
import org.junit.Test

class PhoneUtilsTest {

    @Test
    fun `Lithuanian mobile 8-prefix normalizes to +370`() {
        assertEquals("+37061234567", PhoneUtils.normalize("861234567"))
    }

    @Test
    fun `Lithuanian +370 stays unchanged`() {
        assertEquals("+37061234567", PhoneUtils.normalize("+37061234567"))
    }

    @Test
    fun `370 without plus gets plus added`() {
        assertEquals("+37061234567", PhoneUtils.normalize("37061234567"))
    }

    @Test
    fun `spaces and dashes are stripped`() {
        assertEquals("+37061234567", PhoneUtils.normalize("+370 612 34567"))
        assertEquals("+37061234567", PhoneUtils.normalize("8-612-34567"))
    }

    @Test
    fun `international number with plus stays unchanged`() {
        assertEquals("+491234567890", PhoneUtils.normalize("+491234567890"))
    }

    @Test
    fun `short number returned as-is`() {
        assertEquals("112", PhoneUtils.normalize("112"))
    }

    @Test
    fun `parentheses and dots stripped`() {
        assertEquals("+37061234567", PhoneUtils.normalize("(8)612-345-67"))
    }
}
