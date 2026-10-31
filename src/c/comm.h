// AppMessage glue: phone state in, commands out, and the persisted cache so
// the grid appears instantly on launch.
#pragma once
#include <pebble.h>
#include "logic/model.h"

typedef void (*CommStateHandler)(void);
// status is a STATUS_* from the phone, or one of the COMM_ACK_* (logic/protocol.h)
// when the watch itself gives up. cmd_id 0 is the phone speaking unprompted.
typedef void (*CommAckHandler)(int cmd_id, int status);
// Called each time a command is handed to AppMessage (a retry calls it again).
typedef void (*CommSentHandler)(int cmd_id);
// Called when only comm_phone_responding() changed (no new state arrived), so
// views can redraw their status. Not a state: the send flow must not see it.
typedef void (*CommLinkHandler)(void);

void comm_init(void);
void comm_deinit(void);

const WatchState *comm_state(void);

void comm_set_state_handler(CommStateHandler handler);
void comm_set_ack_handler(CommAckHandler handler);
void comm_set_sent_handler(CommSentHandler handler);
void comm_set_link_handler(CommLinkHandler handler);

// False while sending only because the ready fallback fired: the phone is
// connected but PebbleKit JS has not said anything on this connection.
bool comm_phone_responding(void);

// Queues a command for the phone and returns true once it is accepted. It is
// held until PebbleKit JS has spoken on this connection (or READY_FALLBACK_MS
// passed); a busy or NACKing outbox is then retried a few times. If it never
// goes (including the phone disconnecting while it waits), the ack handler gets
// COMM_ACK_NOT_SENT for this command's id. False when the phone is not connected or too many
// commands are waiting; the caller should tell the user nothing was logged.
bool comm_send(int cmd, int32_t a1, int32_t a2, int32_t a3, int32_t a4);
int comm_last_cmd_id(void);
