# 19.0.1.2.0

`mail.mail` gains three columns (`liwan_kind`, `liwan_attempts`, `liwan_weight`), and the stock `scheduled_date` gains an index, and the
addon two scheduled actions (`data/mail_crons.xml`, `noupdate`). The columns start empty and only rows the new send contract
creates fill them, so no existing row changes and no data needs carrying forward.
