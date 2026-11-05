# Part of Odoo. See LICENSE file for full copyright and licensing details.
"""TikTok Business Messaging webhook envelopes and REST answers used by the adapter tests.

Webhook payloads keep TikTok's own field casing: the event envelope carries `event` and
`user_openid`, and the stringified `content` uses lowercase `type` and `role`. The REST
answers use uppercase `message_type` and `role`, as the live API does.
"""
import hashlib
import hmac
import json

CLIENT_KEY = 'client-key-0123456789'
CLIENT_SECRET = 'client-secret-0123456789'
BUSINESS_ID = 'business-open-id-1'
CONVERSATION_ID = 'conv+1'
SENDER_ID = 'sender-open-id-1'
SENDER_NAME = 'sara'
SENT_AT = 1_790_000_000_000
CREATE_TIME = 1_790_000_000


def envelope(event, content, business_id=BUSINESS_ID, create_time=CREATE_TIME):
    """One webhook delivery: the shared envelope with its `content` stringified as TikTok sends it."""
    return {
        'client_key': CLIENT_KEY,
        'event': event,
        'create_time': create_time,
        'user_openid': business_id,
        'content': json.dumps(content),
    }


def message(type_name='text', block=None, message_id='msg-1', conversation_id=CONVERSATION_ID, **extra):
    """The content of an `im_receive_msg` or `im_send_msg` event."""
    content = {
        'from': SENDER_NAME,
        'to': 'liwan',
        'unique_identifier': SENDER_ID,
        'from_user': {'id': SENDER_ID, 'role': 'personal_account'},
        'to_user': {'id': BUSINESS_ID, 'role': 'business_account'},
        'conversation_id': conversation_id,
        'message_id': message_id,
        'timestamp': SENT_AT,
        'type': type_name,
        **extra,
    }
    if block is not None:
        content[type_name] = block
    return content


def inbound(type_name='text', block=None, **extra):
    """An `im_receive_msg` delivery from the customer."""
    return envelope('im_receive_msg', message(type_name, block, **extra))


def receive_text(body='Hello from TikTok', message_id='msg-text-1', **extra):
    return inbound('text', {'body': body}, message_id=message_id, **extra)


def receive_image(media_id='media-image-1', message_id='msg-image-1'):
    return inbound('image', {'media_id': media_id}, message_id=message_id)


def receive_video(media_id='media-video-1', message_id='msg-video-1'):
    return inbound('video', {'media_id': media_id}, message_id=message_id)


def receive_share_post(embed_url='https://www.tiktok.com/player/v1/7234567890123456789', message_id='msg-share-1'):
    return inbound('share_post', {'embed_url': embed_url, 'video_id': '7234567890123456789'}, message_id=message_id)


def receive_sticker(url='https://cdn.tiktok.com/sticker/1.webp?x-expires=1790000000', message_id='msg-sticker-1'):
    return inbound('sticker', {'url': url}, message_id=message_id)


def receive_emoji(url='https://cdn.tiktok.com/emoji/1.png', message_id='msg-emoji-1'):
    return inbound('emoji', {'url': url}, message_id=message_id)


def receive_template(title='Pick one', button_text='Yes', button_id='opt_yes', message_id='msg-template-1'):
    block = {
        'type': 'qa_button_card',
        'elements': [{'title': title, 'buttons': [{'text': button_text, 'type': 'REPLY', 'id': button_id}]}],
    }
    return inbound('template', block, message_id=message_id)


def receive_reaction(
    operation='ADD', emoji='👍', original_message_id='msg-text-1',
    unique_identifier=SENDER_ID, message_id='msg-reaction-1',
):
    block = [{
        'operation': operation,
        'type': 'EMOJI',
        'emoji': emoji,
        'unique_identifier': unique_identifier,
        'timestamp': SENT_AT,
        'original_msg_id': original_message_id,
    }]
    return inbound('reaction', block, message_id=message_id)


def receive_button_click(option_id='opt_yes', source_message_id='am-reply-1', message_id='msg-click-1'):
    """A text whose `reply_source_payload` names the id of the button the customer tapped."""
    return inbound(
        'text', {'body': 'Yes'},
        message_id=message_id,
        referenced_message_info={'referenced_message_id': source_message_id},
        reply_source_payload={'reply_source_msg_id': source_message_id, 'reply_source_unique_id': option_id},
    )


def send_echo(body='Replied from the TikTok app', message_id='msg-echo-1', conversation_id=CONVERSATION_ID):
    """`im_send_msg`: the business account sent a message, from LiwanOS or from TikTok itself."""
    content = message('text', {'body': body}, message_id=message_id, conversation_id=conversation_id)
    content['from'], content['to'] = 'liwan', SENDER_NAME
    content['from_user'] = {'id': BUSINESS_ID, 'role': 'business_account'}
    content['to_user'] = {'id': SENDER_ID, 'role': 'personal_account'}
    return envelope('im_send_msg', content)


def send_auto_welcome(body='Welcome to the shop', message_id='msg-welcome-1'):
    content = message('text', {'body': body}, message_id=message_id, auto_message_type='WELCOME_MESSAGE')
    content['from'], content['to'] = 'liwan', SENDER_NAME
    content['from_user'] = {'id': BUSINESS_ID, 'role': 'business_account'}
    content['to_user'] = {'id': SENDER_ID, 'role': 'personal_account'}
    return envelope('im_send_msg', content)


def mark_read(by_customer=True, conversation_id=CONVERSATION_ID, last_read_timestamp=SENT_AT, message_id='msg-read-1'):
    """`im_mark_read_msg`; a business-account read is not a customer read."""
    content = message('text', None, message_id=message_id, conversation_id=conversation_id)
    content.pop('type')
    if by_customer:
        content['from'], content['to'] = SENDER_NAME, 'liwan'
        content['from_user'] = {'id': SENDER_ID, 'role': 'personal_account'}
        content['to_user'] = {'id': BUSINESS_ID, 'role': 'business_account'}
    else:
        content['from'], content['to'] = 'liwan', SENDER_NAME
        content['from_user'] = {'id': BUSINESS_ID, 'role': 'business_account'}
        content['to_user'] = {'id': SENDER_ID, 'role': 'personal_account'}
    content['read'] = {'last_read_timestamp': last_read_timestamp}
    return envelope('im_mark_read_msg', content)


def eu_notice(timestamp=SENT_AT):
    """`im_receive_msg_eu`: the sender sits in the EEA, Switzerland or the UK, so no content arrives."""
    return envelope('im_receive_msg_eu', {
        'to': 'liwan',
        'to_user': {'id': BUSINESS_ID, 'role': 'business_account'},
        'timestamp': timestamp,
    })


def referral(source='ad', ref=None, conversation_id=CONVERSATION_ID):
    """`im_referral_msg`: the customer arrived from an ad or a short link."""
    content = message('text', None, message_id='msg-referral-1', conversation_id=conversation_id)
    content.pop('type')
    content['referral'] = ({'source': source, 'ad': {
        'advertiser_id': 'advertiser-1', 'ad_id': 'ad-1', 'ad_name': 'Ramadan ad',
        'embed_url': 'https://www.tiktok.com/player/v1/7234567890123456789',
    }} if source == 'ad' else {'source': source, 'short_link': {'ref': ref or 'campaign_1'}})
    return envelope('im_referral_msg', content)


def auto_message_audit_update(audit_status='APPROVED', auto_message_id='am-1', auto_message_type='SUGGESTED_QUESTION'):
    return envelope('im_auto_message_audit_update', {
        'auto_message_id': auto_message_id,
        'auto_message_type': auto_message_type,
        'audit_status': audit_status,
        'timestamp': SENT_AT,
    })


def auto_message_config_update(action='ENABLE', auto_message_type='WELCOME_MESSAGE', auto_message_id='am-1'):
    return envelope('im_auto_message_config_update', {
        'auto_message_id': auto_message_id,
        'auto_message_type': auto_message_type,
        'auto_message_action': action,
        'timestamp': SENT_AT,
    })


def answer(data, code=0, message='OK'):
    """A TikTok REST answer: `code` 0 means success and `data` carries the payload."""
    return {'code': code, 'message': message, 'data': data}


def conversation_item(conversation_id=CONVERSATION_ID, update_time=SENT_AT, referral=None):
    item = {'conversation_id': conversation_id, 'update_time': update_time}
    if referral:
        item['referral'] = referral
    return item


def conversation_list(conversations=None, has_more=False, cursor=0):
    return answer({
        'conversations': conversations if conversations is not None else [conversation_item()],
        'has_more': has_more,
        'cursor': cursor,
    })


def participant(role='PERSONAL_ACCOUNT', participant_id=SENDER_ID, display_name=SENDER_NAME):
    return {'role': role, 'id': participant_id, 'display_name': display_name, 'profile_image': 'https://cdn/p.png'}


def rest_message(
    message_type='TEXT', block=None, message_id='msg-rest-1', conversation_id=CONVERSATION_ID,
    from_role='PERSONAL_ACCOUNT', from_id=SENDER_ID, **extra,
):
    """One `content/list` message; the REST API names its kind `message_type` in uppercase."""
    content = {
        'message_id': message_id,
        'conversation_id': conversation_id,
        'sender': SENDER_NAME,
        'recipient': 'liwan',
        'timestamp': SENT_AT,
        'from_user': {'role': from_role, 'id': from_id},
        'to_user': {'role': 'BUSINESS_ACCOUNT', 'id': BUSINESS_ID},
        'message_type': message_type,
        **extra,
    }
    if block is not None:
        content[message_type.lower()] = block
    return content


def content_list(messages=None, participants=None):
    return answer({
        'participants': participants if participants is not None else [
            participant(), participant('BUSINESS_ACCOUNT', BUSINESS_ID, 'liwan'),
        ],
        'messages': messages if messages is not None else [rest_message('TEXT', {'body': 'Hi'})],
    })


def auto_message_item(auto_message_type='SUGGESTED_QUESTION', auto_message_id='am-1', audit_status='APPROVED', content=None):
    item = {
        'auto_message_id': auto_message_id,
        'auto_message_type': auto_message_type,
        'audit_status': audit_status,
    }
    item[auto_message_type.lower()] = content or {'question': 'Do you deliver?', 'answer': 'Yes, city-wide.'}
    return item


def auto_message_list(operation_status='ENABLE', items=None, auto_message_type=None):
    return answer({
        'business_id': BUSINESS_ID,
        'operation_status': operation_status,
        'auto_messages': items if items is not None else [auto_message_item(auto_message_type or 'SUGGESTED_QUESTION')],
    })


def raw(data):
    return json.dumps(data).encode()


def signed(body, secret=CLIENT_SECRET, t=CREATE_TIME):
    """The `Tiktok-Signature` header of `body`: `t=<unix s>,s=HMAC_SHA256(secret, "<t>.<body>")`."""
    digest = hmac.new(secret.encode(), b'%d.' % t + body, hashlib.sha256).hexdigest()
    return 't=%d,s=%s' % (t, digest)
