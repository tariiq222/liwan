import { ref } from 'vue'

/**
 * True from before the switch request until the refreshed identity is in place. Browser only: the switch is a click.
 * One switch at a time, and no other request's refusal in that window is read as a change made in another tab.
 */
export const companySwitching = ref(false)
