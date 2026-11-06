# Customer WhatsApp (conversations inbox)
pages: inbox

## Reply to a customer conversation
page: /inbox
1. Open «WhatsApp» from the side rail to see the «Conversations» list.
2. Click the customer's conversation.
3. Make sure «Message type» is set to «Reply».
4. Type in «Write a reply to the customer». To add a file click «Attach a file».
5. Click «Send».
6. If you see «Read only», you do not have permission to reply to conversations.

## Reply after the free-form window has closed
page: /inbox
1. Open the conversation. If you see «The free-form reply window has closed», 24 hours have passed since the customer's last message.
2. Only an approved template can be sent now, so choose one from «Pick an approved template».
3. Fill in the variable values and check the «Message preview».
4. Click «Send».

## Add an internal note
page: /inbox
1. Open the conversation.
2. Under «Message type» choose «Internal note».
3. Write the note. It is never sent to the customer.
4. Click «Save note».

## Assign a conversation or change its status
page: /inbox
1. Open the conversation and click the «Customer and conversation» info icon above it.
2. Under «Conversation» pick the «Assignee», or click «Assign to me» or «Unassign».
3. Change the «Department», «Status» and «Priority», and pick «Tags». Each change saves as soon as you choose it.

## Connect a WhatsApp number (channel)
page: /settings/apps/inbox/channels/new
1. Open «Settings», then «Customer WhatsApp», and go to the «Channels» tab.
2. Click «Connect a channel».
3. Fill in «Name», «Phone number ID», «Business account ID», «Access token» and «App secret» from your Meta app.
4. Click «Connect channel».
5. On the channel page find «Webhook setup», copy the «Callback URL», click «Generate token» and copy the token into the Webhook settings of your Meta app.
6. Click «Test connection» to check it.

## Add a canned reply
page: /settings/apps/inbox
1. Open «Settings», then «Customer WhatsApp», and go to the «Replies and campaigns» tab.
2. In «Canned replies» click «Add canned reply».
3. Fill in the «Shortcut» (without /) and the «Reply text», then click «Save».
4. In a conversation, type / and the start of the shortcut to pick it.
